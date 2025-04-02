document.addEventListener('DOMContentLoaded', () => {
    const svg = document.getElementById('mindmap-svg');
    const contentGroup = document.getElementById('mindmap-content');
    const zoomInButton = document.getElementById('zoom-in');
    const zoomOutButton = document.getElementById('zoom-out');

    if (!svg || !contentGroup || !zoomInButton || !zoomOutButton) {
        console.error("Mindmap HTML elements not found!");
        return;
    }

    let mindMapData = null;
    let currentNode = null;
    let currentZoom = 1.0;
    let currentTranslateX = 0;
    let currentTranslateY = 0;
    const zoomStep = 0.2;
    const nodeDimensions = {};

    // --- Constants for Layout and Appearance ---
    // MODIFICATION 1: Adjust padding for tighter layout
    const autoZoomPadding = 60;  // Reduced padding around content
    const nodePadding = 20;      // Reduced visual space between nodes radially
    const minAutoZoom = 0.2;     // Lower min zoom allowed slightly
    const maxAutoZoom = 1.8;     // Allow slightly more zoom in
    const parentNodePadding = 15; // Fixed padding for parent node in corner

    const SVG_NS = "http://www.w3.org/2000/svg";
    const FIXED_PARENT_CLASS = 'fixed-parent-node-fo'; // Class for parent FO

    // --- Data Loading ---
    async function loadMindmapData() {
        try {
            const response = await fetch('data.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            mindMapData = await response.json();
            if (mindMapData && mindMapData.id) {
                currentNode = findNodeById(mindMapData.id, mindMapData);
                await renderMindmap(); // Initial render
            } else {
                console.error("Mindmap data is empty, invalid, or missing root ID.");
                contentGroup.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="red">Error loading Mindmap Data</text>';
            }
        } catch (error) {
            console.error("Failed to load mindmap data:", error);
            contentGroup.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="red">Failed to load: ${error.message}</text>`;
        }
    }

    // --- Node Finding Utilities ---
    // (findNodeById and findParentNode remain the same)
    function findNodeById(id, node) {
        if (!node) return null;
        if (node.id === id) {
            return node;
        }
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const found = findNodeById(id, child);
                if (found) {
                    return found;
                }
            }
        }
        return null;
    }

    function findParentNode(childId, node, parent = null) {
        if (!node) return undefined;
        if (node.id === childId) {
            return parent;
        }
        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                const foundParent = findParentNode(childId, child, node);
                if (foundParent !== undefined) {
                    return foundParent;
                }
            }
        }
        return undefined;
    }


    // --- Rendering Logic ---
    async function renderMindmap() {
        if (!currentNode || !svg) return;

        console.log("Rendering node:", currentNode.id);

        // MODIFICATION 2: Clear previous content AND remove old fixed parent
        contentGroup.innerHTML = '';
        const existingParent = svg.querySelector(`.${FIXED_PARENT_CLASS}`);
        if (existingParent) {
            svg.removeChild(existingParent);
        }
        // ---

        const svgRect = svg.getBoundingClientRect();
        const viewWidth = svgRect.width;
        const viewHeight = svgRect.height;

        // --- 1. Prepare Node Element Promises & Get Dimensions ---
        const elementPromises = [];
        const nodesToRender = []; // Holds ALL nodes initially for measurement

        // Add Center Node
        nodesToRender.push({ data: currentNode, isCenter: true });
        elementPromises.push(createNodeElement(currentNode, 0, 0, true, false)); // Center is not parent

        // Find Parent and Children
        const parentData = findParentNode(currentNode.id, mindMapData);
        const childrenData = currentNode.children || [];

        // Add Parent Node Promise (if exists) - Mark as parent
        if (parentData) {
            nodesToRender.push({ data: parentData, isParent: true }); // Add for measurement
            elementPromises.push(createNodeElement(parentData, 0, 0, false, true));
        }

        // Add Child Node Promises
        childrenData.forEach(child => {
            nodesToRender.push({ data: child, isChild: true });
            elementPromises.push(createNodeElement(child, 0, 0, false, false)); // Child is not parent
        });

        // --- Wait for all node elements to be created and measured ---
        const createdElements = await Promise.all(elementPromises);

        // Assign elements and dimensions back to nodesToRender
        let centerNodeInfo = null;
        let parentNodeInfo = null; // Store parent separately
        const childNodesInfo = [];   // Store children separately for layout
        nodesToRender.forEach((nodeInfo, index) => {
            nodeInfo.element = createdElements[index];
            nodeInfo.dim = nodeDimensions[nodeInfo.data.id]; // Get cached/measured dimensions
            if (!nodeInfo.dim) { // Fallback
                console.error("Dimension missing for node", nodeInfo.data.id);
                nodeInfo.dim = { width: 100, height: 40 };
                nodeInfo.element.setAttribute('width', nodeInfo.dim.width);
                nodeInfo.element.setAttribute('height', nodeInfo.dim.height);
            }

            // Separate the nodes
            if (nodeInfo.isCenter) {
                centerNodeInfo = nodeInfo;
            } else if (nodeInfo.isParent) {
                parentNodeInfo = nodeInfo; // Keep parent info aside
            } else if (nodeInfo.isChild) {
                childNodesInfo.push(nodeInfo); // Add children to their own list
            }
        });

        if (!centerNodeInfo) {
            console.error("Center node info not found!"); return;
        }

        // MODIFICATION 3: Handle Fixed Parent Node Positioning
        if (parentNodeInfo) {
            parentNodeInfo.element.setAttribute('x', parentNodePadding); // Use constant for padding
            parentNodeInfo.element.setAttribute('y', parentNodePadding);
            // Add the parent directly to the SVG, outside the zoom/pan group
            svg.appendChild(parentNodeInfo.element);
            console.log("Positioned fixed parent:", parentNodeInfo.data.id);
        }
        // --- End Parent Handling ---


        // --- 2. Position Center Node AT ORIGIN (0,0 initially) for layout calculation ---
        const centerDim = centerNodeInfo.dim;
        const centerLayoutX = 0;
        const centerLayoutY = 0;
        centerNodeInfo.layoutX = centerLayoutX - centerDim.width / 2;
        centerNodeInfo.layoutY = centerLayoutY - centerDim.height / 2;

        // Bounding box starts with the center node (relative to layout origin 0,0)
        let renderMinX = centerNodeInfo.layoutX, renderMaxX = centerNodeInfo.layoutX + centerDim.width,
            renderMinY = centerNodeInfo.layoutY, renderMaxY = centerNodeInfo.layoutY + centerDim.height;
        let hasRenderedElements = true; // We always have at least the center node

        // Add center node element to the zoom/pan group
        centerNodeInfo.element.setAttribute('x', centerNodeInfo.layoutX);
        centerNodeInfo.element.setAttribute('y', centerNodeInfo.layoutY);
        contentGroup.appendChild(centerNodeInfo.element);

        // --- 3. Calculate Layout for CHILD Nodes relative to (0,0) ---
        const numChildNodes = childNodesInfo.length;
        if (numChildNodes === 0) {
            console.log("No children to render for node:", currentNode.id);
             // Auto-zoom based only on the center node's bounds
            applyAutoZoomAndPan(renderMinX, renderMaxX, renderMinY, renderMaxY, hasRenderedElements, svgRect);
            applyZoomAndPan();
            return; // Nothing more to layout
        }

        // Determine initial radius based on children
        let maxChildRadius = 0;
         childNodesInfo.forEach(nodeInfo => {
             const nodeRadius = Math.sqrt(nodeInfo.dim.width**2 + nodeInfo.dim.height**2) / 2;
             maxChildRadius = Math.max(maxChildRadius, nodeRadius);
         });
         const centerRadius = Math.sqrt(centerDim.width**2 + centerDim.height**2) / 2;

         let radius = centerRadius + maxChildRadius + nodePadding * 2; // Min radius based on center + largest child + padding

        // MODIFICATION 4: Adjust default radius calculation for tighter layout
        const defaultRadius = Math.max(viewWidth, viewHeight) * 0.32; // Reduced multiplier
        radius = Math.max(radius, defaultRadius);

        // --- 4. Calculate Angular Requirements for Children ---
        let totalAngleRequired = 0;
        childNodesInfo.forEach(nodeInfo => {
            const effectiveWidthForAngle = nodeInfo.dim.width + nodePadding; // Use reduced nodePadding
            const angle = 2 * Math.atan((effectiveWidthForAngle / 2) / radius);
            nodeInfo.requiredAngle = angle;
            totalAngleRequired += angle;
        });

        // --- Adjust radius if children overlap angularly ---
        const availableAngle = 2 * Math.PI;
        if (totalAngleRequired > availableAngle * 1.01) {
             const requiredRadiusIncreaseFactor = totalAngleRequired / availableAngle;
             radius *= requiredRadiusIncreaseFactor * 1.1; // Increase radius
             // Recalculate angles with new radius
             totalAngleRequired = 0;
             childNodesInfo.forEach(nodeInfo => {
                 const effectiveWidthForAngle = nodeInfo.dim.width + nodePadding;
                 const angle = 2 * Math.atan((effectiveWidthForAngle / 2) / radius);
                 nodeInfo.requiredAngle = angle;
                 totalAngleRequired += angle;
             });
             console.log("Increased radius for children to:", radius);
        } else {
             // Distribute remaining space evenly among children
             const remainingAngle = availableAngle - totalAngleRequired;
             const extraPaddingPerNode = remainingAngle / numChildNodes;
             childNodesInfo.forEach(nodeInfo => {
                 nodeInfo.requiredAngle += extraPaddingPerNode;
             });
             totalAngleRequired = availableAngle;
        }

        // --- 5. Distribute CHILD Nodes by Angle & Position RELATIVE TO (0,0) ---
        const linesToRender = [];
        let currentAngle = -Math.PI / 2; // Start at the top

        // No sorting needed now, just layout children
        childNodesInfo.forEach(nodeInfo => {
            const nodeDim = nodeInfo.dim;
            const nodeW = nodeDim.width;
            const nodeH = nodeDim.height;
            const placementAngle = currentAngle + (nodeInfo.requiredAngle / 2);

            // Calculate position relative to the layout origin (0,0)
            const layoutX = centerLayoutX + radius * Math.cos(placementAngle) - nodeW / 2;
            const layoutY = centerLayoutY + radius * Math.sin(placementAngle) - nodeH / 2;

            nodeInfo.layoutX = layoutX;
            nodeInfo.layoutY = layoutY;

            // Set the actual SVG element position and add to zoom/pan group
            nodeInfo.element.setAttribute('x', layoutX);
            nodeInfo.element.setAttribute('y', layoutY);
            contentGroup.appendChild(nodeInfo.element);

            // Create connection line FROM center TO child
             const line = createConnectionLine(
                 centerLayoutX, centerLayoutY,             // From center layout origin
                 layoutX + nodeW / 2, layoutY + nodeH / 2, // To center of this child
                 false // Not a parent link
             );
             linesToRender.push(line);

            // Update rendering bounds based on child layout coordinates
            renderMinX = Math.min(renderMinX, layoutX);
            renderMaxX = Math.max(renderMaxX, layoutX + nodeW);
            renderMinY = Math.min(renderMinY, layoutY);
            renderMaxY = Math.max(renderMaxY, layoutY + nodeH);
            // hasRenderedElements is already true

            currentAngle += nodeInfo.requiredAngle;
        });

        // Add lines to SVG zoom/pan group (drawn underneath nodes)
        linesToRender.forEach(line => contentGroup.insertBefore(line, contentGroup.firstChild));

        // --- 6. Auto Zoom & Pan Calculation (based on center + children bounds) ---
        applyAutoZoomAndPan(renderMinX, renderMaxX, renderMinY, renderMaxY, hasRenderedElements, svgRect);
        applyZoomAndPan(); // Apply the final zoom and translation to contentGroup
    }

    // --- Node Element Creation (Add class for fixed parent) ---
    async function createNodeElement(nodeData, x, y, isCenter = false, isParent = false) {
        const foreignObject = document.createElementNS(SVG_NS, 'foreignObject');
        foreignObject.setAttribute('x', 0);
        foreignObject.setAttribute('y', 0);
        foreignObject.setAttribute('width', '1');
        foreignObject.setAttribute('height', '1');
        foreignObject.setAttribute('data-id', nodeData.id);
        foreignObject.classList.add('node-foreign-object');
        if (isParent) {
             // MODIFICATION 5: Add specific class to parent FO
             foreignObject.classList.add(FIXED_PARENT_CLASS);
        }
        foreignObject.style.pointerEvents = 'none';

        // Description only shown for non-parent nodes now
        const descriptionHTML = (!isParent && nodeData.description)
            ? `<p class="node-description">${escapeHTML(nodeData.description)}</p>`
            : '';

        const nodeContentHTML = `
            <div xmlns="http://www.w3.org/1999/xhtml" class="node-content ${isCenter ? 'is-center' : ''} ${isParent ? 'is-parent' : ''}">
                <h3 class="node-title">${escapeHTML(nodeData.title)}</h3>
                ${descriptionHTML}
            </div>
        `;
        foreignObject.innerHTML = nodeContentHTML;

        // Measurement and Heuristic Logic (remains the same as previous version)
        let finalWidth, finalHeight;
        if (nodeDimensions[nodeData.id]) {
            const cachedDim = nodeDimensions[nodeData.id];
            finalWidth = cachedDim.width;
            finalHeight = cachedDim.height;
        } else {
            const computedStyle = window.getComputedStyle(foreignObject.querySelector('.node-content') || document.createElement('div'));
            const cssMaxWidth = parseInt(computedStyle.maxWidth, 10) || 350;
            const measuredDim = await getNodeDimensions(foreignObject, cssMaxWidth);

            if (measuredDim && measuredDim.width > 0 && measuredDim.height > 0) {
                 finalWidth = measuredDim.width;
                 finalHeight = measuredDim.height;
                 const maxTallnessRatio = 1.5;
                 const absoluteMaxWidth = cssMaxWidth;

                 if (finalHeight > finalWidth * maxTallnessRatio && finalWidth < absoluteMaxWidth) {
                    const targetWidth = Math.sqrt(finalWidth * finalHeight);
                    const newWidth = Math.min(absoluteMaxWidth, Math.max(finalWidth, targetWidth));
                    if (newWidth > finalWidth * 1.05) {
                       finalWidth = Math.round(newWidth);
                    }
                 }
            } else {
                 const fallbackW = 150, fallbackH = isParent ? 40 : (isCenter ? 80: 60); // Keep parent fallback reasonable
                 console.warn("Measurement failed for node:", nodeData.id, ". Using fallback:", { width: fallbackW, height: fallbackH });
                 finalWidth = fallbackW;
                 finalHeight = fallbackH;
            }
            nodeDimensions[nodeData.id] = { width: finalWidth, height: finalHeight };
        }

        foreignObject.setAttribute('width', finalWidth);
        foreignObject.setAttribute('height', finalHeight);

        // Attach click listener
        const finalContentDiv = foreignObject.querySelector('.node-content');
        if (finalContentDiv) {
            finalContentDiv.style.pointerEvents = 'auto';
            finalContentDiv.addEventListener('click', (event) => {
                event.stopPropagation();
                handleNodeClick(nodeData.id);
            });
        }

        return foreignObject;
    }


    // --- Dimension Calculation (remains the same) ---
    async function getNodeDimensions(foreignObjectElement, cssMaxWidth) {
        // ... (Implementation from previous step is unchanged) ...
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.visibility = 'hidden';
        tempContainer.style.pointerEvents = 'none';
        tempContainer.style.width = '500px';

        const tempForeignObject = foreignObjectElement.cloneNode(true);
        tempForeignObject.setAttribute('width', '1');
        tempForeignObject.setAttribute('height', '1');

        const innerDiv = tempForeignObject.querySelector('.node-content');
        if (innerDiv) {
             innerDiv.style.display = 'inline-block';
             innerDiv.style.boxSizing = 'border-box';
        }

        const tempSvg = document.createElementNS(SVG_NS, 'svg');
        tempSvg.appendChild(tempForeignObject);
        tempContainer.appendChild(tempSvg);
        document.body.appendChild(tempContainer);

        return new Promise(resolve => {
             setTimeout(() => {
                requestAnimationFrame(() => {
                    let width = 0, height = 0;
                    const contentDiv = tempForeignObject.querySelector('.node-content');

                    if (contentDiv) {
                        width = contentDiv.offsetWidth;
                        height = contentDiv.offsetHeight;
                        if (width < 10 || height < 10) {
                           console.warn("getNodeDimensions: Measured small dims:", foreignObjectElement.getAttribute('data-id'), "W:", width, "H:", height);
                        }
                    } else {
                        console.warn("getNodeDimensions: Could not find .node-content.");
                    }

                    document.body.removeChild(tempContainer);

                    const minWidth = 50;
                    const minHeight = 30;
                    resolve({
                        width: Math.max(width || 0, minWidth),
                        height: Math.max(height || 0, minHeight)
                    });
                });
             }, 0);
        });
    }

    // --- Connection Line Creation (remains the same) ---
    function createConnectionLine(x1, y1, x2, y2, isParentLink = false) {
        // This function is now only called for child links
        const line = document.createElementNS(SVG_NS, 'path');
        const pathData = `M ${x1} ${y1} L ${x2} ${y2}`;
        line.setAttribute('d', pathData);
        line.classList.add('connection-line');
        // The 'to-parent' class is no longer used here, but could be repurposed if needed
        // if (isParentLink) {
        //     line.classList.add('to-parent');
        // }
        return line;
    }

    // --- Auto Zoom & Pan Logic (remains the same, operates on contentGroup bounds) ---
    function applyAutoZoomAndPan(minX, maxX, minY, maxY, hasElements, svgRect) {
        // ... (Implementation from previous step is unchanged) ...
        // It correctly uses the bounds derived only from center + children
        const viewWidth = svgRect.width;
        const viewHeight = svgRect.height;

        if (hasElements && isFinite(minX) && maxX > minX && maxY > minY) {
            const renderedWidth = maxX - minX;
            const renderedHeight = maxY - minY;
            const scaleX = viewWidth / (renderedWidth + autoZoomPadding * 2); // Use reduced padding
            const scaleY = viewHeight / (renderedHeight + autoZoomPadding * 2); // Use reduced padding
            let targetZoom = Math.min(scaleX, scaleY);
            targetZoom = Math.max(minAutoZoom, Math.min(maxAutoZoom, targetZoom));
            currentZoom = targetZoom;

            const contentCenterX = minX + renderedWidth / 2;
            const contentCenterY = minY + renderedHeight / 2;
            const svgCenterX = viewWidth / 2;
            const svgCenterY = viewHeight / 2;

            currentTranslateX = svgCenterX - contentCenterX * currentZoom;
            currentTranslateY = svgCenterY - contentCenterY * currentZoom;

            // console.log(`AutoFit: W=${renderedWidth.toFixed(0)}, H=${renderedHeight.toFixed(0)}. Zoom=${currentZoom.toFixed(2)}. Translate=(${currentTranslateX.toFixed(0)}, ${currentTranslateY.toFixed(0)})`);

        } else {
            // console.log("AutoFit: Resetting zoom/pan");
            currentZoom = 1.0;
             if(hasElements && isFinite(minX)){
                 const contentCenterX = minX + (maxX - minX) / 2;
                 const contentCenterY = minY + (maxY - minY) / 2;
                 const svgCenterX = viewWidth / 2;
                 const svgCenterY = viewHeight / 2;
                 currentTranslateX = svgCenterX - contentCenterX;
                 currentTranslateY = svgCenterY - contentCenterY;
             } else {
                currentTranslateX = viewWidth / 2;
                currentTranslateY = viewHeight / 2;
             }
        }
    }

    // --- Event Handlers (handleNodeClick, handleZoomIn/Out remain the same) ---
     function handleNodeClick(nodeId) {
        console.log("Node clicked:", nodeId);
        const targetNode = findNodeById(nodeId, mindMapData);

        if (targetNode) {
            // Clicking the *current* center node - navigate UP only if parent exists
            if (currentNode && targetNode.id === currentNode.id) {
                const parent = findParentNode(currentNode.id, mindMapData);
                if (parent) {
                    console.log("Navigating UP to parent:", parent.id);
                    currentNode = parent;
                    renderMindmap();
                } else {
                    console.log("Clicked center node (root), no parent to navigate to.");
                }
                return;
            }

            // Clicking a different visible node (child OR the fixed parent)
             console.log("Navigating TO node:", targetNode.id);
             currentNode = targetNode;
             renderMindmap(); // Re-render with the clicked node as center

        } else {
            console.warn("Clicked node ID not found in data:", nodeId);
        }
    }

     function handleZoomIn() {
        currentZoom = Math.min(maxAutoZoom, currentZoom + zoomStep); // Use maxAutoZoom
        applyZoomAndPan();
    }

     function handleZoomOut() {
        currentZoom = Math.max(minAutoZoom, currentZoom - zoomStep);
        applyZoomAndPan();
    }

    // --- Utilities (applyZoomAndPan, escapeHTML remain the same) ---
    function applyZoomAndPan() {
        contentGroup.style.transformOrigin = `0 0`;
        contentGroup.style.transform = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${currentZoom})`;
        // console.log(`Applied Transform: Zoom=${currentZoom.toFixed(2)}, Translate=(${currentTranslateX.toFixed(0)}, ${currentTranslateY.toFixed(0)})`);
    }

    function escapeHTML(str) {
        // ... (Implementation unchanged) ...
        if (!str) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // --- Initialization (including resize handler remains the same) ---
    zoomInButton.addEventListener('click', handleZoomIn);
    zoomOutButton.addEventListener('click', handleZoomOut);

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            console.log("Window resized, re-rendering...");
             Object.keys(nodeDimensions).forEach(key => delete nodeDimensions[key]);
            renderMindmap();
        }, 250);
    });

    loadMindmapData(); // Start
});