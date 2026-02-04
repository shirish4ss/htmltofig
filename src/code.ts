figma.showUI(__html__, { width: 450, height: 700, themeColors: true });

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'resize') {
        figma.ui.resize(msg.width, msg.height);
    }

    if (msg.type === 'resize-plugin') {
        if (msg.minimized) figma.ui.resize(360, 48);
        else figma.ui.resize(450, 700);
    }

    if (msg.type === 'generate-ui') {
        const { prompt } = msg;
        createPlaceholderDesign(prompt);
    }

    if (msg.type === 'html-structure' || msg.type === 'import-html') {
        const { structure, name, detectedWidth } = msg;
        const width = detectedWidth || 1200;
        
        const mainFrame = figma.createFrame();
        mainFrame.name = name || 'Imported Design';
        mainFrame.resize(width, 800);
        
        // Use the first element of structure (usually body)
        const rootNodes = Array.isArray(structure) ? structure : [structure];
        for (const nodeData of rootNodes) {
            await processNode(nodeData, mainFrame);
        }
        
        figma.currentPage.appendChild(mainFrame);
        figma.viewport.scrollAndZoomIntoView([mainFrame]);
        
        // Save to history
        addToHistory(name || 'Unnamed Import', name ? 'URL/File' : 'Pasted HTML');
    }

    if (msg.type === 'load-history' || msg.type === 'get-history') {
        const history = await figma.clientStorage.getAsync('import-history') || [];
        figma.ui.postMessage({ type: 'history-updated', history });
        figma.ui.postMessage({ type: 'history-data', history });
    }
};

async function processNode(nodeData: any, parent: FrameNode | GroupNode) {
    if (!nodeData) return;

    let node: SceneNode;
    const styles = nodeData.styles;

    if (nodeData.tagName === 'svg' && nodeData.svgContent) {
        try {
            node = figma.createNodeFromSvg(nodeData.svgContent);
        } catch (e) {
            node = figma.createFrame();
        }
    } else if (nodeData.type === 'TEXT' || nodeData.text && !nodeData.children?.length) {
        const textNode = figma.createText();
        await applyStylesToText(textNode, styles);
        textNode.characters = nodeData.text || nodeData.characters || '';
        node = textNode;
    } else {
        const frame = figma.createFrame();
        frame.name = `<${nodeData.tagName}>`;
        
        // Fills
        const fills: Paint[] = [];
        
        // Background Color
        if (styles.backgroundColor && styles.backgroundColor !== 'transparent' && styles.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            fills.push({
                type: 'SOLID',
                color: parseColor(styles.backgroundColor),
                opacity: parseOpacity(styles.backgroundColor)
            });
        }

        // Image Fill (from <img>)
        if (nodeData.imageData) {
            const image = figma.createImage(new Uint8Array(nodeData.imageData));
            fills.push({
                type: 'IMAGE',
                imageHash: image.hash,
                scaleMode: 'FILL'
            });
        }

        // Background Image Fill (from CSS background-image)
        if (nodeData.backgroundImageData) {
            const image = figma.createImage(new Uint8Array(nodeData.backgroundImageData));
            fills.push({
                type: 'IMAGE',
                imageHash: image.hash,
                scaleMode: 'FILL'
            });
        }

        frame.fills = fills;

        // Borders
        const borderWidth = parseInt(styles.borderWidth) || 0;
        if (borderWidth > 0) {
            frame.strokes = [{ type: 'SOLID', color: parseColor(styles.borderColor) }];
            frame.strokeWeight = borderWidth;
            if (styles.borderStyle === 'dashed') frame.dashPattern = [4, 4];
        }

        // Radius
        frame.topLeftRadius = parseInt(styles.borderTopLeftRadius || styles.borderRadius) || 0;
        frame.topRightRadius = parseInt(styles.borderTopRightRadius || styles.borderRadius) || 0;
        frame.bottomLeftRadius = parseInt(styles.borderBottomLeftRadius || styles.borderRadius) || 0;
        frame.bottomRightRadius = parseInt(styles.borderBottomRightRadius || styles.borderRadius) || 0;

        // Effects
        if (styles.boxShadow && styles.boxShadow !== 'none') {
            const shadow = parseBoxShadow(styles.boxShadow);
            if (shadow) frame.effects = [shadow];
        }

        // Layout
        if (styles.display === 'flex') {
            frame.layoutMode = styles.flexDirection === 'column' ? 'VERTICAL' : 'HORIZONTAL';
            frame.paddingTop = parseInt(styles.paddingTop) || 0;
            frame.paddingRight = parseInt(styles.paddingRight) || 0;
            frame.paddingBottom = parseInt(styles.paddingBottom) || 0;
            frame.paddingLeft = parseInt(styles.paddingLeft) || 0;

            if (styles.justifyContent === 'center') frame.primaryAxisAlignItems = 'CENTER';
            else if (styles.justifyContent === 'flex-end') frame.primaryAxisAlignItems = 'MAX';
            else if (styles.justifyContent === 'space-between') frame.primaryAxisAlignItems = 'SPACE_BETWEEN';

            if (styles.alignItems === 'center') frame.counterAxisAlignItems = 'CENTER';
        }

        node = frame;
    }

    // Common properties
    if (nodeData.rect) {
        node.x = nodeData.rect.x;
        node.y = nodeData.rect.y;
        if ('resize' in node) {
            node.resize(Math.max(nodeData.rect.width, 1), Math.max(nodeData.rect.height, 1));
        }
    }

    if (parent) {
        if (parent.type === 'FRAME') parent.appendChild(node);
    }

    // Children
    if (nodeData.children && nodeData.children.length > 0 && node.type === 'FRAME') {
        for (const childData of nodeData.children) {
            await processNode(childData, node as FrameNode);
        }
    }

    return node;
}

async function applyStylesToText(textNode: TextNode, styles: any) {
    const family = (styles.fontFamily || 'Inter').split(',')[0].replace(/['"]/g, '').trim();
    const weight = parseInt(styles.fontWeight) || 400;
    let styleName = 'Regular';
    if (weight >= 700) styleName = 'Bold';
    else if (weight >= 500) styleName = 'Medium';

    try {
        await figma.loadFontAsync({ family, style: styleName });
        textNode.fontName = { family, style: styleName };
    } catch (e) {
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
        textNode.fontName = { family: 'Inter', style: 'Regular' };
    }

    textNode.fontSize = parseInt(styles.fontSize) || 16;
    textNode.fills = [{ type: 'SOLID', color: parseColor(styles.color || 'rgb(0,0,0)') }];
}

function parseColor(color: string): { r: number, g: number, b: number } {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
        return {
            r: parseInt(match[1]) / 255,
            g: parseInt(match[2]) / 255,
            b: parseInt(match[3]) / 255
        };
    }
    return { r: 0, g: 0, b: 0 };
}

function parseOpacity(color: string): number {
    const match = color.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
    return match ? parseFloat(match[1]) : 1;
}

function parseBoxShadow(boxShadow: string): Effect | null {
    const colorMatch = boxShadow.match(/rgba?\(.*?\)/);
    if (!colorMatch) return null;
    const colorStr = colorMatch[0];
    const rest = boxShadow.replace(colorStr, '').trim();
    const parts = rest.split(/\s+/).map(p => parseInt(p) || 0);
    if (parts.length >= 3) {
        return {
            type: 'DROP_SHADOW',
            color: { ...parseColor(colorStr), a: parseOpacity(colorStr) },
            offset: { x: parts[0], y: parts[1] },
            radius: parts[2],
            spread: 0,
            visible: true,
            blendMode: 'NORMAL'
        };
    }
    return null;
}

function createPlaceholderDesign(prompt: string) {
    const rect = figma.createRectangle();
    rect.name = `AI: ${prompt}`;
    rect.resize(400, 300);
    rect.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.3, b: 0.9 } }];
    figma.viewport.scrollAndZoomIntoView([rect]);
}

async function addToHistory(name: string, type: string) {
    let history = await figma.clientStorage.getAsync('import-history') || [];
    history.unshift({ name, type, timestamp: Date.now() });
    history = history.slice(0, 10);
    await figma.clientStorage.setAsync('import-history', history);
    figma.ui.postMessage({ type: 'history-updated', history });
}
