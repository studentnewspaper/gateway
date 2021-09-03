import { NodeType, parse, HTMLElement } from "node-html-parser";

export function cleanHtml(html: string): string {
  const doc = parse(html);

  let isFirstElement = true;
  for (const node of doc.childNodes) {
    if (node.nodeType != NodeType.ELEMENT_NODE) {
      doc.removeChild(node);
      continue;
    }

    // If the first element in the first paragraph is a <br/>, delete
    const element = node as HTMLElement;
    if (isFirstElement) {
      isFirstElement = false;

      if (element.tagName == "P") {
        if (
          element.childNodes.length > 0 &&
          element.firstChild.nodeType == NodeType.ELEMENT_NODE
        ) {
          let firstElement: HTMLElement = element.firstChild as HTMLElement;
          if (firstElement.tagName == "BR") {
            element.removeChild(firstElement);
          }
        }
      }
    }
  }

  return doc.toString().trim();
}
