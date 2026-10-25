export function updateCardDrag(gesture, clientX, clientY) {
  const dx = clientX - gesture.x, dy = clientY - gesture.y;
  // 一旦离开点击容差，就始终属于拖拽，即使后来又回到起点。
  gesture.dragged ||= Math.hypot(dx, dy) > 12;
  return { x: dx, y: dy };
}

export function resolveCardDrag(gesture, clientX, clientY, handTop) {
  updateCardDrag(gesture, clientX, clientY);
  if (!gesture.dragged) return 'tap';
  return gesture.y - clientY > 58 && clientY < handTop - 12 ? 'play' : 'cancel';
}
