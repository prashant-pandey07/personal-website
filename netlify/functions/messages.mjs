const WORKER_URL = "https://temp-inbox.prashantexperimentiqw.workers.dev";

const ALLOWED_RECIPIENTS = [
  "public@prashant-pandey.com.np",
  "temp@prashant-pandey.com.np",
  "use@prashant-pandey.com.np",
  "test@prashant-pandey.com.np",
  "free@prashant-pandey.com.np",
  "prash@prashant-pandey.com.np",
];

const RECIPIENT_SET = new Set(ALLOWED_RECIPIENTS);
const MAX_BODY_CHARS = 12000;
const MAX_LINKS = 20;
const MAX_CREDENTIALS = 16;

const VERIFY_CONTEXT = /\b(?:verif(?:y|ication)|confirm(?:ation)?|activat(?:e|ion)|sign[ -]?in|log[ -]?in|magic link|reset (?:your )?password|authenticate|one[ -]?time|security check)\b/i;
const VERIFY_URL = /(?:verify|verification|confirm|confirmation|activate|activation|magic[/-]?link|reset[-_/]?(?:password|credential)|authenticate|one[-_/]?time)/i;
const CODE_CONTEXT = /\b(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time|activation|access|recovery|backup|otp)?\s*(?:verification\s+)?(?:code|passcode|pin|otp)\b/i;
const ATTACHMENT_CONTEXT = /\b(?:attachment|attached|download|file|document|photo|image|video|invoice|receipt|spreadsheet|presentation|report|shared (?:file|folder|document|image|photo|video)|view (?:the )?(?:file|document|photo|image|attachment)|click to (?:view|download))\b/i;
const ATTACHMENT_EXTENSION = /\.(?:pdf|docx?|docm|xlsx?|xlsm|csv|pptx?|pptm|zip|rar|7z|tar|tgz|gz|png|jpe?g|gif|webp|svg|heic|avif|tiff?|mp4|mov|webm|mp3|m4a|wav|txt|md|json|xml|ya?ml|sql|apk|ics|iso|dmg)(?:$|[?#])/i;
const FILE_SHARE_HOST = /(?:drive\.google\.com|docs\.google\.com|dropbox\.com|dropboxusercontent\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com|mega\.nz|wetransfer\.com|mediafire\.com|icloud\.com|pcloud\.com|filemail\.com|sendgb\.com|notion\.(?:so|site)|canva\.com|figma\.com)/i;
const SHARE_PATH = /(?:^|[\/_?.&#=-])(?:share|shared|file|files|attachment|attachments|download|media|document|documents)(?:[\/_?.&#=-]|$)/i;
const CREDENTIAL_LABELS = [
  "user name", "username", "user id", "userid", "user number", "user no", "login id", "login name", "login", "user", "account id", "account number", "account no", "customer id", "customer number", "customer no", "member id", "member number", "client id", "client identifier", "reference id", "transaction id", "order id", "subscriber id", "id",
  "password", "passwd", "pwd", "passphrase", "passcode", "api key", "api token", "secret key", "secret", "client secret", "access key", "access token", "private key", "public key", "security key",
  "recovery key", "recovery code", "recovery codes", "recovery phrase", "activation key", "license key", "serial number", "bearer token", "session token", "refresh token", "auth token", "jwt", "token", "authentication key", "key", "email address", "e-mail address", "email", "e-mail",
];
const CREDENTIAL_SIGNAL = /\b(?:user[\s_-]*(?:name|id|number|no)|username|login(?:[\s_-]*(?:id|name))?|account[\s_-]*(?:id|number|no)|customer[\s_-]*(?:id|number|no)|member[\s_-]*(?:id|number)|client[\s_-]*(?:id|identifier|secret)|reference[\s_-]*id|transaction[\s_-]*id|order[\s_-]*id|subscriber[\s_-]*id|password|passwd|pwd|passphrase|passcode|api[\s_-]*(?:key|token)|secret(?:[\s_-]*key)?|access[\s_-]*(?:key|token)|private[\s_-]*key|public[\s_-]*key|security[\s_-]*key|recovery[\s_-]*(?:key|code|codes|phrase)|activation[\s_-]*key|license[\s_-]*key|serial[\s_-]*number|(?:bearer|session|refresh|auth|authentication)[\s_-]*token|jwt)\b/i;
const STOP_VALUES = new Set(["is", "was", "your", "the", "below", "above", "here", "required", "shown", "listed", "provided", "sent", "available", "and", "or", "username", "user", "userid", "password", "passcode", "token", "key", "email", "address", "number", "id"]);

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function safeString(value) {
  return value == null ? "" : String(value).trim();
}

function firstString(...values) {
  return values.map(safeString).find(Boolean) || "";
}

function firstText(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function decodeHtml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
    const token = code.toLowerCase();
    if (token === "amp") return "&";
    if (token === "lt") return "<";
    if (token === "gt") return ">";
    if (token === "quot") return '"';
    if (token === "apos") return "'";
    if (token === "nbsp") return " ";
    const number = token.startsWith("#x") ? parseInt(token.slice(2), 16) : Number(token.slice(1));
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : entity; } catch { return entity; }
  });
}

function htmlToText(html) {
  return decodeHtml(String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title|noscript)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/(?:p|div|section|article|h[1-6]|li|tr|blockquote)\s*>/gi, "\n")
    .replace(/<\s*(?:td|th)\b[^>]*>/gi, ": ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeMimeData(value, encoding = "base64") {
  const source = safeString(value);
  if (!source) return "";
  if (/quoted-printable/i.test(encoding)) {
    return source.replace(/=\r?\n/g, "").replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
  if (!/base64/i.test(encoding) || typeof atob !== "function") return source;
  try {
    const normalized = source.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return source;
  }
}

function parseMimeHeaders(value) {
  const headers = new Map();
  let previous = "";
  for (const line of safeString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (/^\s/.test(line) && previous) {
      headers.set(previous, `${headers.get(previous) || ""} ${line.trim()}`.trim());
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    previous = line.slice(0, separator).trim().toLowerCase();
    headers.set(previous, line.slice(separator + 1).trim());
  }
  return headers;
}

function mimeBoundary(contentType) {
  const match = safeString(contentType).match(/\bboundary\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i);
  return match?.[1] || match?.[2] || match?.[3] || "";
}

function splitMimeParts(value, boundary) {
  const parts = [];
  let current = null;
  for (const line of safeString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const marker = line.trim();
    if (marker === `--${boundary}`) {
      if (current !== null) parts.push(current.join("\n"));
      current = [];
    } else if (marker === `--${boundary}--`) {
      if (current !== null) parts.push(current.join("\n"));
      current = null;
      break;
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) parts.push(current.join("\n"));
  return parts;
}

function parseMimeEntity(value, depth = 0) {
  if (depth > 8) return { text: "", html: "" };
  const source = safeString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source) return { text: "", html: "" };

  const separator = source.indexOf("\n\n");
  const headerText = separator < 0 ? "" : source.slice(0, separator);
  const body = separator < 0 ? source : source.slice(separator + 2);
  const headers = parseMimeHeaders(headerText);
  const contentType = headers.get("content-type") || "";
  const disposition = headers.get("content-disposition") || "";
  if (/\battachment\b/i.test(disposition)) return { text: "", html: "" };

  if (/^\s*multipart\//i.test(contentType)) {
    const nested = parseMimeParts(body, mimeBoundary(contentType), depth + 1);
    if (nested) return nested;
  }

  if (/^\s*text\/plain\b/i.test(contentType)) {
    return { text: decodeMimeData(body, headers.get("content-transfer-encoding") || "").trim(), html: "" };
  }
  if (/^\s*text\/html\b/i.test(contentType)) {
    return { text: "", html: decodeMimeData(body, headers.get("content-transfer-encoding") || "").trim() };
  }

  return parseMimeBody(source, depth + 1) || { text: "", html: "" };
}

function parseMimeParts(value, boundary, depth = 0) {
  if (depth > 8) return null;
  const source = safeString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const resolvedBoundary = boundary || source.match(/^--([^\s]+)\s*$/m)?.[1] || "";
  if (!resolvedBoundary) return null;
  const sections = splitMimeParts(source, resolvedBoundary);
  if (!sections.length) return null;

  let text = "";
  let html = "";
  for (const section of sections) {
    const parsed = parseMimeEntity(section, depth + 1);
    if (!text && parsed.text) text = parsed.text;
    if (!html && parsed.html) html = parsed.html;
  }
  return text || html ? { text, html } : null;
}

function parseMimeBody(value, depth = 0) {
  if (depth > 8) return null;
  const source = safeString(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!source) return null;

  const headerEnd = source.indexOf("\n\n");
  const headerText = headerEnd < 0 ? "" : source.slice(0, headerEnd);
  const headers = parseMimeHeaders(headerText);
  const contentType = headers.get("content-type") || "";
  const body = headerEnd < 0 ? source : source.slice(headerEnd + 2);
  if (/^\s*multipart\//i.test(contentType)) {
    return parseMimeParts(body, mimeBoundary(contentType), depth + 1);
  }
  if (/^\s*text\/(?:plain|html)\b/i.test(contentType)) {
    const parsed = parseMimeEntity(source, depth + 1);
    return parsed.text || parsed.html ? parsed : null;
  }

  const boundary = source.match(/^--([^\s]+)\s*$/m)?.[1] || "";
  return boundary ? parseMimeParts(source, boundary, depth + 1) : null;
}

function parseStructuredValue(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !/^[\[{]/.test(value.trim())) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}

function getBodyParts(message) {
  const rawBody = parseStructuredValue(message.body);
  const rawContent = parseStructuredValue(message.content);
  const rawPayload = parseStructuredValue(message.payload);
  const rawEmail = parseStructuredValue(message.email);
  const rawMessage = parseStructuredValue(message.message);
  const body = rawBody && typeof rawBody === "object" ? rawBody : {};
  const content = rawContent && typeof rawContent === "object" ? rawContent : {};
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const email = rawEmail && typeof rawEmail === "object" ? rawEmail : {};
  const nestedMessage = rawMessage && typeof rawMessage === "object" ? rawMessage : {};
  let html = firstText(message.html_body, message.htmlBody, message.body_html, message.bodyHtml, message.html, message.content_html, message.html_content, message.raw_html, message.htmlContent, body.html, body.html_body, body.body_html, content.html, content.html_body, payload.html, email.html_body, email.body_html, nestedMessage.html_body, nestedMessage.body_html);
  let text = firstText(message.text_body, message.textBody, message.body_text, message.bodyText, message.text, message.plain_text, message.plainText, message.plaintext, message.plain_body, message.body_plain, message.body_plaintext, message.content_text, message.text_content, message.raw_text, message.textContent, body.text, body.text_body, body.body_text, content.text, content.text_body, payload.text, email.text_body, email.body_text, nestedMessage.text_body, nestedMessage.body_text);
  const generic = firstText(typeof rawBody === "string" ? rawBody : "", typeof rawContent === "string" ? rawContent : "", message.message_body, message.email_body, message.snippet, typeof rawMessage === "string" ? rawMessage : "");

  if (generic) {
    if (!html && /<\s*(?:html|body|div|p|br|table|span|a|h[1-6])\b/i.test(generic)) html = generic;
    else if (!text) text = generic;
  }

  const visitMimeParts = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      node.slice(0, 80).forEach((part) => visitMimeParts(part, depth + 1));
      return;
    }
    const mime = firstString(node.mimeType, node.mime_type, node.contentType, node.content_type, node.type).toLowerCase();
    const transferEncoding = firstString(node.encoding, node.content_transfer_encoding, node.contentTransferEncoding);
    const partBody = node.body && typeof node.body === "object" ? node.body : node;
    const data = firstText(partBody.data, partBody.content, node.data, node.content);
    if (data && /text\/(?:plain|html)/i.test(mime)) {
      const decoded = decodeMimeData(data, transferEncoding || (partBody === node ? "" : "base64"));
      if (/text\/html/i.test(mime) && !html) html = decoded;
      if (/text\/plain/i.test(mime) && !text) text = decoded;
    }
    for (const key of ["parts", "payload", "body", "content"]) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((part) => visitMimeParts(part, depth + 1));
      else if (child && typeof child === "object") visitMimeParts(child, depth + 1);
    }
  };
  for (const source of [rawPayload, rawBody, rawContent, rawEmail, rawMessage]) visitMimeParts(source);

  // Some mailbox backends store the original multipart MIME envelope in a
  // text/body column instead of splitting its plain and HTML alternatives.
  // Extract those alternatives before detection or returning the full message.
  const mimeBody = parseMimeBody(html) || parseMimeBody(text) || parseMimeBody(generic);
  if (mimeBody) {
    if (mimeBody.text) text = mimeBody.text;
    if (mimeBody.html) html = mimeBody.html;
  }

  const plainText = text || (html ? htmlToText(html) : "");
  return { html, text: plainText };
}

function normalizeUrl(value) {
  const decoded = decodeHtml(safeString(value)).replace(/[),.;!?\]}>'"]+$/g, "");
  if (!decoded || decoded.length > 4096) return "";
  try {
    const parsed = new URL(decoded);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function extractLinks(html, text, message) {
  const links = new Map();
  const add = (url, label = "", explicit = false, isVerification = false, isAttachment = false) => {
    const href = normalizeUrl(url);
    if (!href) return;
    const key = href;
    const previous = links.get(key);
    links.set(key, {
      url: href,
      label: firstString(label, previous?.label, "Open link").slice(0, 140),
      explicit: Boolean(explicit || previous?.explicit),
      is_verification: Boolean(isVerification || previous?.is_verification),
      is_attachment: Boolean(isAttachment || previous?.is_attachment),
    });
  };

  const itemUrl = (item) => typeof item === "string" ? item : firstString(item?.url, item?.href, item?.link, item?.link_url, item?.linkUrl, item?.web_url, item?.view_url, item?.preview_url, item?.permalink, item?.download, item?.download_url, item?.downloadUrl, item?.download_link, item?.attachment_link, item?.attachment_url, item?.attachmentUrl, item?.file_link, item?.file_url, item?.fileUrl, item?.shared_link, item?.share_link, item?.share_url, item?.shareUrl, item?.public_link, item?.public_url, item?.publicUrl, item?.direct_url);
  const collectItems = (value, label = "") => {
    if (typeof value === "string") {
      if (/^[\[{]/.test(value.trim())) {
        try { return collectItems(JSON.parse(value), label); } catch { /* Treat non-JSON text as a possible URL below. */ }
      }
      return [{ url: value, label }];
    }
    if (Array.isArray(value)) return value.slice(0, 30).flatMap((item) => collectItems(item, label));
    if (!value || typeof value !== "object") return [];
    const url = itemUrl(value);
    if (url) return [{ ...value, url, label: firstString(value.label, value.name, value.filename, value.file_name, label) }];
    return Object.entries(value).slice(0, 30).flatMap(([name, item]) => collectItems(item, name));
  };

  for (const item of collectItems([message.verification_link, message.verification_url, message.confirmation_link, message.verificationLink])) {
    add(item.url, firstString(item.label, "Verification link"), true, true);
  }

  for (const source of [message.verification_links, message.verificationLinks, message.verification_links_json, message.detected_links, message.detected_links_json, message.links, message.links_json]) {
    for (const item of collectItems(source, "Link")) {
      add(item.url, item.label, [message.verification_links, message.verificationLinks, message.verification_links_json].includes(source), item.is_verification || item.isVerification, item.is_attachment || item.isAttachment);
    }
  }

  for (const source of [message.attachment, message.attachments, message.attachments_json, message.attachment_link, message.attachment_links, message.attachmentLinks, message.attachment_url, message.attachmentUrl, message.attachment_urls, message.attachmentUrls, message.file_link, message.file_links, message.fileLinks, message.file_url, message.fileUrl, message.file_urls, message.fileUrls, message.download_link, message.download_links, message.downloadLinks, message.download_url, message.downloadUrl, message.shared_file, message.shared_files, message.shared_link, message.shared_links, message.sharedLinks, message.shared_urls, message.sharedUrls, message.share_link, message.share_links, message.shareLinks, message.share_url, message.shareUrl, message.public_links, message.publicLinks, message.resource_links, message.resourceLinks, message.files, message.documents]) {
    for (const item of collectItems(source, "Attachment")) add(item.url, item.label || "Attachment", false, false, true);
  }

  const visibleHtml = safeString(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title|noscript|svg|iframe|object)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  if (visibleHtml) {
    const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
    let match;
    while ((match = anchorPattern.exec(visibleHtml))) {
      const near = htmlToText(visibleHtml.slice(Math.max(0, match.index - 260), Math.min(visibleHtml.length, match.index + match[0].length + 260)));
      add(match[1] || match[2] || match[3], htmlToText(match[4]).slice(0, 140), false, VERIFY_CONTEXT.test(near), ATTACHMENT_CONTEXT.test(near));
    }
  }

  const urlPattern = /https?:\/\/[^\s<>{}"']+/gi;
  let match;
  while ((match = urlPattern.exec(text || ""))) {
    const near = text.slice(Math.max(0, match.index - 130), match.index + match[0].length + 130);
    add(match[0], "Link", false, VERIFY_CONTEXT.test(near), ATTACHMENT_CONTEXT.test(near));
  }

  const sourceText = `${text}\n${htmlToText(html || "")}`;
  return Array.from(links.values()).map((link) => {
    let parsed;
    try { parsed = new URL(link.url); } catch { /* Already validated by normalizeUrl. */ }
    const contextIndex = sourceText.toLowerCase().indexOf(link.url.toLowerCase());
    const context = contextIndex < 0 ? "" : sourceText.slice(Math.max(0, contextIndex - 130), contextIndex + link.url.length + 130);
    const pathAndQuery = parsed ? `${parsed.pathname}${parsed.search}` : link.url;
    const isAttachment = link.is_attachment || ATTACHMENT_CONTEXT.test(`${link.label} ${pathAndQuery} ${context}`) || ATTACHMENT_EXTENSION.test(`${pathAndQuery} ${link.label}`) || FILE_SHARE_HOST.test(parsed?.hostname || "") || SHARE_PATH.test(pathAndQuery);
    const isVerification = link.is_verification || VERIFY_URL.test(`${link.label} ${link.url}`) || (VERIFY_CONTEXT.test(`${link.label} ${context}`) && links.size === 1);
    return { ...link, is_attachment: isAttachment, is_verification: isVerification };
  }).slice(0, MAX_LINKS);
}

function validDetectedCode(value) {
  const code = safeString(value).replace(/^[#:=\s]+|[.,;!?]+$/g, "");
  if (/^\d{4,8}$/.test(code)) return code;
  if (/^[A-Z0-9-]{5,16}$/.test(code) && /\d/.test(code)) return code;
  if (/^[A-Z]{6,10}$/.test(code)) return code;
  return "";
}

function detectCode(subject, text, existing) {
  const explicit = safeString(existing);
  if (explicit) return explicit.slice(0, 80);
  const source = `${subject}\n${text}`;
  if (!CODE_CONTEXT.test(source)) return "";
  const patterns = [
    /\b(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time|otp)\s+(?:verification\s+)?(?:code|passcode|pin|otp)\b[\s:=-]*(?:is\s+)?[#:]?\s*([A-Z0-9][A-Z0-9-]{3,15})/gi,
    /\b(?:code|passcode|otp)\s*(?:is|:|=|-)?\s*[:=]?\s*([A-Z0-9][A-Z0-9-]{3,15})\b/gi,
    /\b([A-Z0-9][A-Z0-9-]{3,15})\b[\s,.:;!()-]{0,8}(?:is\s+(?:your|the)\s+)?(?:verification|security|confirmation|login|one[ -]?time)?\s*(?:code|passcode|otp)\b/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const code = validDetectedCode(match[1]);
      if (code) return code;
    }
  }
  for (const line of safeString(text).split(/\r?\n/).map((item) => item.trim())) {
    const candidate = line.match(/^[#:=\s]*([A-Z0-9][A-Z0-9-]{3,15})[.,;!?]*$/i)?.[1];
    const code = candidate ? validDetectedCode(candidate) : "";
    if (code) return code;
    const grouped = line.match(/^[#:=\s]*((?:\d{3,4}[ -])+\d{2,4})[.,;!?]*$/)?.[1]?.replace(/[ -]/g, "");
    if (grouped && validDetectedCode(grouped)) return grouped;
  }
  return "";
}

function normalizeCredentialLabel(value) {
  const compact = safeString(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(user ?name|username|login name|login|user)$/.test(compact)) return "Username";
  if (/^(userid|user id|user number|user no|login id|account id|account number|account no|customer id|customer number|customer no|member id|member number|client id|client identifier|reference id|transaction id|order id|subscriber id)$/.test(compact)) return "User ID";
  if (compact === "id") return "ID";
  if (/^(password|passwd|pwd|passphrase|passcode)$/.test(compact)) return compact === "passcode" ? "Passcode" : "Password";
  if (/^(secret|client secret)$/.test(compact)) return "Secret";
  if (/^(api key|secret key|access key|private key|public key|security key|recovery key|activation key|license key|authentication key|key)$/.test(compact)) return "Key";
  if (/^(api token|access token|bearer token|session token|refresh token|auth token|jwt|token)$/.test(compact)) return "Token";
  if (/^recovery codes?$/.test(compact)) return "Recovery code";
  if (/^recovery phrase$/.test(compact)) return "Recovery phrase";
  if (/^serial number$/.test(compact)) return "Serial number";
  if (/^(email|e mail|email address|e mail address)$/.test(compact)) return "Email";
  return "";
}

function extractCredentials(text, supplied) {
  supplied = parseStructuredValue(supplied);
  const found = new Map();
  const add = (label, value) => {
    const normalizedLabel = normalizeCredentialLabel(label);
    let safeValue = safeString(value).trim();
    const quoted = safeValue.match(/^(["'`])([\s\S]*)\1$/);
    if (quoted) safeValue = quoted[2];
    safeValue = safeValue.replace(/[\s,;|]+$/g, "").slice(0, 500);
    if (!normalizedLabel || !safeValue || STOP_VALUES.has(safeValue.toLowerCase())) return;
    found.set(`${normalizedLabel.toLowerCase()}|${safeValue}`, { label: normalizedLabel, value: safeValue });
  };

  if (Array.isArray(supplied)) {
    for (const item of supplied) {
      if (item && typeof item === "object") add(item.label || item.name || item.type, item.value || item.secret);
    }
  } else if (supplied && typeof supplied === "object") {
    for (const [label, value] of Object.entries(supplied)) {
      if (typeof value === "string" || typeof value === "number") add(label, value);
      else if (value && typeof value === "object") add(label, value.value || value.secret || value.token || value.code);
    }
  }

  const labels = CREDENTIAL_LABELS.slice().sort((a, b) => b.length - a.length)
    .map((label) => label.replace(/\s+/g, "\\s*")).join("|");
  const valuePattern = "(?:\\\"[^\\\"\\n]{2,}\\\"|'[^'\\n]{2,}'|`[^`\\n]{2,}`|[^\\s,;|<>]{2,})";
  const explicitPattern = new RegExp(`\\b(${labels})\\b\\s*(?::|=|-|\\bis\\b)\\s*[:=]?\\s*(${valuePattern})`, "gi");
  const rowPattern = new RegExp(`\\b(${labels})\\b\\s*\\n\\s*(${valuePattern})`, "gi");
  const inlineRowPattern = new RegExp(`(?:^|\\n)\\s*(${labels})\\s{1,4}(?!is\\b)(${valuePattern})`, "gim");
  for (const pattern of [explicitPattern, rowPattern, inlineRowPattern]) {
    let match;
    while ((match = pattern.exec(text))) add(match[1], match[2]);
  }

  return Array.from(found.values()).slice(0, MAX_CREDENTIALS);
}

function analyzeMessage(message, { includeBody = false } = {}) {
  const subject = safeString(message.subject);
  const body = getBodyParts(message);
  const text = `${subject}\n${body.text}`;
  const links = extractLinks(body.html, body.text, message);
  const verifyContext = VERIFY_CONTEXT.test(text);
  const verificationLinks = links.filter((link) =>
    link.explicit || link.is_verification || VERIFY_URL.test(`${link.label} ${link.url}`)
  );
  if (!verificationLinks.length && verifyContext) {
    const contextualVerificationLink = links.find((link) => !link.is_attachment);
    if (contextualVerificationLink) verificationLinks.push(contextualVerificationLink);
  }

  const explicitCode = firstString(message.verification_code, message.verificationCode, message.otp, message.otp_code, message.one_time_code, message.security_code, message.code);
  const suppliedCredentials = message.detected_credentials || message.credentials || message.login_details || message.access_details || message.account_details || message.auth_details || message.credentials_json;
  const credentials = extractCredentials(text, suppliedCredentials);
  const detectedCode = detectCode(subject, body.text, explicitCode);
  const providedCredentialLabels = Array.isArray(message.credential_labels) ? message.credential_labels : [];
  const credentialLabels = Array.from(new Set([
    ...credentials.map((item) => item.label),
    ...providedCredentialLabels.map(normalizeCredentialLabel).filter(Boolean),
  ]));
  const hasCredentialSignal = credentials.length > 0 || credentialLabels.length > 0 || CREDENTIAL_SIGNAL.test(text);
  const result = {
    id: message.id,
    sender: message.sender,
    recipient: message.recipient,
    subject: message.subject,
    received_at: message.received_at,
    verification_code: detectedCode || null,
    has_code: Boolean(detectedCode),
    body_available: Boolean(body.text || body.html),
    links,
    verification_links: verificationLinks,
    attachment_links: links.filter((link) => link.is_attachment && !link.is_verification),
    has_links: links.length > 0,
    has_attachments: links.some((link) => link.is_attachment && !link.is_verification),
    link_count: links.length,
    verification_link_count: verificationLinks.length,
    attachment_link_count: links.filter((link) => link.is_attachment && !link.is_verification).length,
    credential_labels: credentialLabels,
    detected_credentials: includeBody ? credentials : [],
    has_credentials: hasCredentialSignal,
  };
  if (includeBody) {
    result.body_text = body.text.slice(0, MAX_BODY_CHARS);
    if (body.html) result.body_html = body.html.slice(0, MAX_BODY_CHARS);
  }
  return result;
}

async function fetchWorkerMessages(token, recipient) {
  const workerUrl = new URL(`${WORKER_URL}/api/messages`);
  workerUrl.searchParams.set("limit", "50");
  if (recipient) workerUrl.searchParams.set("recipient", recipient);

  const response = await fetch(workerUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) throw new Error(`Worker returned ${response.status}`);
  const data = await response.json();
  if (!data || !Array.isArray(data.messages)) throw new Error("Worker returned an invalid message list");
  return data.messages.filter((message) => message && typeof message === "object");
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
  }

  const token = process.env.INBOX_API_TOKEN;
  if (!token) return json({ error: "Server configuration missing" }, 500);

  const url = new URL(request.url);
  const requestedRecipient = safeString(url.searchParams.get("recipient")).toLowerCase();
  const allInboxes = !requestedRecipient || requestedRecipient === "all";
  if (!allInboxes && !RECIPIENT_SET.has(requestedRecipient)) {
    return json({ error: "Unknown recipient address" }, 400);
  }

  const messageId = safeString(url.searchParams.get("message_id"));
  if (messageId) {
    if (allInboxes) return json({ error: "Choose a specific inbox to open a message" }, 400);
    try {
      const items = await fetchWorkerMessages(token, requestedRecipient);
      const message = items.find((item) => safeString(item.id) === messageId);
      if (!message) return json({ error: "Message not found" }, 404);
      return json({ message: analyzeMessage({ ...message, recipient: message.recipient || requestedRecipient }, { includeBody: true }) });
    } catch (error) {
      console.error("Message body fetch failed:", error.message);
      return json({ error: "Could not load this message" }, 502);
    }
  }

  try {
    // The worker returns its latest messages when recipient is omitted, so the
    // combined inbox only needs one upstream request instead of six.
    const items = await fetchWorkerMessages(token, allInboxes ? "" : requestedRecipient);
    const messages = items.map((message) => analyzeMessage({
      ...message,
      recipient: message.recipient || (allInboxes ? "" : requestedRecipient),
    }));
    const unique = new Map();
    for (const message of messages) {
      unique.set(safeString(message.id) || `${message.recipient}|${message.sender}|${message.subject}|${message.received_at}`, message);
    }
    const sorted = Array.from(unique.values()).sort((a, b) => (Date.parse(b.received_at || "") || 0) - (Date.parse(a.received_at || "") || 0));
    return json({ messages: sorted, refreshed: allInboxes ? ALLOWED_RECIPIENTS : [requestedRecipient], failed: [] });
  } catch (error) {
    console.error("Inbox fetch failed:", error.message);
    return json({ error: "Inbox service unavailable" }, 502);
  }
}
