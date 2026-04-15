function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function getColor(i) {
  const colors = ["red", "blue", "green", "orange", "purple"];

  return colors[i % colors.length];
}
