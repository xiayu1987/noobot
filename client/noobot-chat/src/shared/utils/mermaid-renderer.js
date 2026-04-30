import mermaid from "mermaid";

let mermaidInitialized = false;

function ensureMermaidInitialized() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
  });
  mermaidInitialized = true;
}

export async function renderMermaidInElement(containerElement = null) {
  if (!containerElement) return;
  const mermaidNodes = containerElement.querySelectorAll(".mermaid");
  if (!mermaidNodes.length) return;
  ensureMermaidInitialized();
  await mermaid.run({ nodes: mermaidNodes });
  const renderedSvgs = containerElement.querySelectorAll(".mermaid svg");
  for (const svgElement of renderedSvgs) {
    svgElement.style.setProperty("max-width", "100%", "important");
    svgElement.style.removeProperty("width");
    svgElement.style.setProperty("height", "auto", "important");
    svgElement.style.setProperty("display", "block");
    svgElement.style.setProperty("margin", "0 auto");
  }
}
