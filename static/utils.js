function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function getColor(i) {
  const colors = ["red", "blue", "green", "orange"];

  return colors[i % 4];
}
