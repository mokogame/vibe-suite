const { EventEmitter } = require("node:events");

const CHAT_EVENTS_KEY = Symbol.for("vibe-im.chat-events");
const emitter = globalThis[CHAT_EVENTS_KEY] || new EventEmitter();
globalThis[CHAT_EVENTS_KEY] = emitter;

function publishChatMessage(messageRow) {
  if (!messageRow?.id) return messageRow;
  emitter.emit("message", messageRow);
  return messageRow;
}

function onChatMessage(listener) {
  emitter.on("message", listener);
  return () => emitter.off("message", listener);
}

module.exports = {
  publishChatMessage,
  onChatMessage
};
