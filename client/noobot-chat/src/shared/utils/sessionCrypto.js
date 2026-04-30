function textToBytes(text = "") {
  return new TextEncoder().encode(String(text || ""));
}

function bytesToText(bytes = new Uint8Array()) {
  return new TextDecoder().decode(bytes);
}

function xorBytes(data = new Uint8Array(), key = new Uint8Array()) {
  if (!data?.length || !key?.length) return new Uint8Array();
  const out = new Uint8Array(data.length);
  for (let byteIndex = 0; byteIndex < data.length; byteIndex += 1) {
    out[byteIndex] = data[byteIndex] ^ key[byteIndex % key.length];
  }
  return out;
}

function bytesToBase64(bytes = new Uint8Array()) {
  let binary = "";
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) binary += String.fromCharCode(bytes[byteIndex]);
  return btoa(binary);
}

function base64ToBytes(base64 = "") {
  const binary = atob(String(base64 || ""));
  const out = new Uint8Array(binary.length);
  for (let byteIndex = 0; byteIndex < binary.length; byteIndex += 1) out[byteIndex] = binary.charCodeAt(byteIndex);
  return out;
}

export function encryptPayloadBySessionId(payload = {}, sessionId = "") {
  const sid = String(sessionId || "").trim();
  if (!sid) throw new Error("sessionId required for encryption");
  const plainText =
    typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const source = textToBytes(plainText);
  const key = textToBytes(sid);
  return bytesToBase64(xorBytes(source, key));
}

export function decryptPayloadBySessionId(cipherText = "", sessionId = "") {
  const sid = String(sessionId || "").trim();
  if (!sid) throw new Error("sessionId required for decryption");
  const source = base64ToBytes(String(cipherText || ""));
  const key = textToBytes(sid);
  const text = bytesToText(xorBytes(source, key));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
