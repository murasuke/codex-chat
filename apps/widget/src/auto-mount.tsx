import { mountHelpWidget } from "./embed";

const rootId = "help-chat-widget-root";
let root = document.getElementById(rootId);

if (!root) {
  root = document.createElement("div");
  root.id = rootId;
  document.body.appendChild(root);
}

mountHelpWidget(root);
