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
}

