"use strict";

const API_URL = "/.netlify/functions/messages";
const REFRESH_MS = 10000;
const MAX_BACKOFF_MS = 60000;
const REQUEST_TIMEOUT_MS = 12000;
const READ_STORAGE_KEY = "prashmail-read-messages-v2";
const CACHE_STORAGE_KEY = "prashmail-inbox-summaries-v1";
const CACHE_TIME_KEY = "prashmail-inbox-checked-at-v1";
const CACHE_LIMIT = 50;
const ATTACHMENT_CONTEXT = /\b(?:attachment|attached|download|file|document|photo|image|video|invoice|receipt|spreadsheet|presentation|report|shared (?:file|folder|document|image|photo|video)|view (?:the )?(?:file|document|photo|image|attachment)|click to (?:view|download))\b/i;
const ATTACHMENT_EXTENSION = /\.(?:pdf|docx?|docm|xlsx?|xlsm|csv|pptx?|pptm|zip|rar|7z|tar|tgz|gz|png|jpe?g|gif|webp|svg|heic|avif|tiff?|mp4|mov|webm|mp3|m4a|wav|txt|md|json|xml|ya?ml|sql|apk|ics|iso|dmg)(?:$|[?#])/i;
const FILE_SHARE_HOST = /(?:drive\.google\.com|docs\.google\.com|dropbox\.com|dropboxusercontent\.com|1drv\.ms|onedrive\.live\.com|sharepoint\.com|box\.com|mega\.nz|wetransfer\.com|mediafire\.com|icloud\.com|pcloud\.com|filemail\.com|sendgb\.com|notion\.(?:so|site)|canva\.com|figma\.com)/i;
const SHARE_PATH = /(?:^|[\/_?.&#=-])(?:share|shared|file|files|attachment|attachments|download|media|document|documents)(?:[\/_?.&#=-]|$)/i;
const ADDRESSES = [
  "public@prashant-pandey.com.np",
  "temp@prashant-pandey.com.np",
  "use@prashant-pandey.com.np",
  "test@prashant-pandey.com.np",
  "free@prashant-pandey.com.np",
  "prash@prashant-pandey.com.np"
];

const $ = (id) => document.getElementById(id);
const mailboxList = $("mailboxList");
const mobileMailbox = $("mailboxMobile");
const refreshButtons = [$("refresh"), $("refreshWide")].filter(Boolean);
const autoRefresh = $("autoRefresh");
const statusElement = $("status");
const statusIndicator = $("statusIndicator");
const searchInput = $("search");
const messagesElement = $("messages");
const countElement = $("count");
const openMessages = new Set();
const arrivalKeys = new Set();
const messagesByInbox = new Map(ADDRESSES.map((address) => [address, []]));
const analysisCache = new WeakMap();

let selectedMailbox = "all";
let activeFilter = "all";
let isLoading = false;
let queuedManualRefresh = false;
let refreshTimer = null;
let lastUpdatedAt = null;
let failureCount = 0;
let initialSyncComplete = false;
let searchRenderTimer = null;
let readMessageKeys = loadReadState();

function loadReadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function saveReadState() {
  try {
    if (readMessageKeys.size > 1000) readMessageKeys = new Set(Array.from(readMessageKeys).slice(-500));
    localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(readMessageKeys)));
  } catch { /* This visit still works without storage. */ }
}

function safeText(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = safeText(text);
  return node;
}

function makeIcon(name, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.appendChild(use);
  return svg;
}

function messageKey(message) {
  if (message.id != null && String(message.id)) return String(message.id);
  return [message.recipient, message.sender, message.subject, message.received_at, message.verification_code]
    .map((part) => safeText(part)).join("|");
}

function messageListSignature(messages) {
  return messages.map((message) => [
    messageKey(message), message.received_at, message.subject, message.verification_code,
    Boolean(message.body_available), Boolean(message.has_code || message.verification_code), Boolean(message.has_credentials),
    Boolean(message.has_links), Boolean(message.has_attachments), Number(message.verification_link_count || 0), Number(message.attachment_link_count || 0), Number(message.link_count || 0),
    (message.credential_labels || []).join(","),
    (message.links || []).map((link) => typeof link === "string" ? link : link.url || link.href).join(","),
    (message.verification_links || []).map((link) => typeof link === "string" ? link : link.url || link.href).join(","),
    (message.attachment_links || []).map((link) => typeof link === "string" ? link : link.url || link.href).join(",")
  ].map((item) => safeText(item)).join("\u001f")).join("\u001e");
}

function sortMessages(messages) {
  return messages.sort((a, b) => (Date.parse(b.received_at || "") || 0) - (Date.parse(a.received_at || "") || 0));
}

function getAllCachedMessages() {
  const unique = new Map();
  for (const address of ADDRESSES) {
    for (const message of messagesByInbox.get(address) || []) unique.set(messageKey(message), message);
  }
  return sortMessages(Array.from(unique.values()));
}

function getCurrentMessages() {
  return selectedMailbox === "all"
    ? getAllCachedMessages()
    : messagesByInbox.get(selectedMailbox) || [];
}

function unreadCount(messages) {
  return messages.reduce((total, message) => total + (readMessageKeys.has(messageKey(message)) ? 0 : 1), 0);
}

function initials(value) {
  const cleaned = safeText(value, "?").trim();
  const name = cleaned.includes("<") ? cleaned.split("<")[0].trim() : cleaned.split("@")[0];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase() || "?";
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatCompactDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function bodyInfo(message) {
  const htmlBody = message.html_body ?? message.htmlBody ?? message.body_html ?? message.bodyHtml ?? message.html ?? message.content_html ?? message.body?.html ?? message.content?.html ?? "";
  const suppliedText = message.text_body ?? message.textBody ?? message.body_text ?? message.bodyText ?? message.text ?? message.plain_text ?? message.plain_body ?? message.content_text ?? message.body?.text ?? message.content?.text ?? "";
  let renderedHtml = safeText(htmlBody);
  let text = safeText(suppliedText);
  const links = [];

  if (htmlBody) {
    const parsed = new DOMParser().parseFromString(String(htmlBody), "text/html");
    parsed.querySelectorAll("script, style, noscript, iframe, object, svg").forEach((node) => node.remove());
    for (const anchor of parsed.querySelectorAll("a[href]")) {
      const context = anchor.parentElement?.textContent?.trim().slice(0, 260) || "";
      links.push({ url: anchor.getAttribute("href"), label: anchor.textContent.trim(), context, source: "html" });
    }
    if (!text) text = parsed.body.textContent || "";
  }

  const genericBody = typeof message.body === "string" ? message.body : typeof message.content === "string" ? message.content : safeText(message.message_body);
  if (!text && genericBody) {
    const generic = genericBody;
    if (/<\s*(?:html|body|div|p|br|table|span|a|h[1-6])\b/i.test(generic)) {
      const parsed = new DOMParser().parseFromString(generic, "text/html");
      parsed.querySelectorAll("script, style, noscript, iframe, object, svg").forEach((node) => node.remove());
      if (!renderedHtml) renderedHtml = generic;
      for (const anchor of parsed.querySelectorAll("a[href]")) {
        const context = anchor.parentElement?.textContent?.trim().slice(0, 260) || "";
        links.push({ url: anchor.getAttribute("href"), label: anchor.textContent.trim(), context, source: "html" });
      }
      text = parsed.body.textContent || "";
    } else {
      text = generic;
    }
  }

  return { text: safeText(text).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), html: renderedHtml, links };
}

const INLINE_EMAIL_TAGS = new Set(["A", "B", "BLOCKQUOTE", "BR", "CODE", "DD", "DEL", "DIV", "DL", "DT", "EM", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "LI", "OL", "P", "PRE", "S", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "U", "UL"]);
const INLINE_EMAIL_DROP_TAGS = new Set(["APPLET", "AUDIO", "BUTTON", "CANVAS", "EMBED", "FORM", "IFRAME", "INPUT", "OBJECT", "SCRIPT", "SELECT", "STYLE", "SVG", "TEXTAREA", "VIDEO"]);

function appendLinkifiedText(parent, value) {
  const text = safeText(value);
  const urlPattern = /https?:\/\/[^\s<>]+/gi;
  let cursor = 0;
  let match;
  while ((match = urlPattern.exec(text))) {
    const href = normalizedUrl(match[0]);
    if (!href) continue;
    const raw = match[0];
    const visibleUrl = raw.replace(/[),.;!?\]}>'"]+$/g, "");
    const trailing = raw.slice(visibleUrl.length);
    parent.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    const anchor = makeElement("a", "inline-email-link", visibleUrl);
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.referrerPolicy = "no-referrer";
    parent.append(anchor, document.createTextNode(trailing));
    cursor = match.index + raw.length;
  }
  parent.appendChild(document.createTextNode(text.slice(cursor)));
}

function renderEmailBody(html, text, loading = false) {
  const container = makeElement("div", `mail-body mail-body-rich${loading ? " is-loading" : ""}`);
  if (!html) {
    appendLinkifiedText(container, text);
    return container;
  }

  const parsed = new DOMParser().parseFromString(String(html), "text/html");
  const copySafeNode = (source, destination) => {
    if (source.nodeType === Node.TEXT_NODE) {
      destination.appendChild(document.createTextNode(source.nodeValue || ""));
      return;
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return;
    if (INLINE_EMAIL_DROP_TAGS.has(source.tagName)) return;
    if (source.tagName === "IMG") {
      const alt = safeText(source.getAttribute("alt")).trim();
      if (alt) destination.appendChild(document.createTextNode(`[Image: ${alt}]`));
      return;
    }
    if (!INLINE_EMAIL_TAGS.has(source.tagName)) {
      for (const child of source.childNodes) copySafeNode(child, destination);
      return;
    }

    const element = document.createElement(source.tagName.toLowerCase());
    if (source.tagName === "A") {
      const href = normalizedUrl(source.getAttribute("href"));
      if (href) {
        element.className = "inline-email-link";
        element.href = href;
        element.target = "_blank";
        element.rel = "noopener noreferrer";
        element.referrerPolicy = "no-referrer";
      }
    } else if (source.tagName === "TD" || source.tagName === "TH") {
      for (const attribute of ["colspan", "rowspan"]) {
        const value = source.getAttribute(attribute);
        if (/^\d{1,2}$/.test(value || "")) element.setAttribute(attribute, value);
      }
    }
    for (const child of source.childNodes) copySafeNode(child, element);
    destination.appendChild(element);
  };

  for (const child of parsed.body.childNodes) copySafeNode(child, container);
  if (!container.textContent?.trim()) appendLinkifiedText(container, text);
  return container;
}

function normalizedUrl(value) {
  const clean = safeText(value).replace(/&amp;/gi, "&").replace(/[),.;!?\]}>'"]+$/g, "");
  if (!clean || clean.length > 4096) return "";
  try {
    const url = new URL(clean);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return "";
    return url.href;
  } catch {
    return "";
  }
}

function detectCode(source, explicitCode) {
  const explicit = safeText(explicitCode).trim();
  if (explicit) return explicit;
  const context = /\b(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time|activation|access|recovery|backup|otp)?\s*(?:verification\s+)?(?:code|passcode|pin|otp)\b/i;
  if (!context.test(source)) return "";
  const patterns = [
    /\b(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time|activation|access|recovery|backup|otp)\s+(?:verification\s+)?(?:code|passcode|pin|otp)\b[\s:=-]*(?:is\s+)?[#:]?\s*([A-Z0-9][A-Z0-9-]{3,15})/gi,
    /\b(?:code|passcode|otp)\s*(?:is|:|=|-)?\s*[:=]?\s*([A-Z0-9][A-Z0-9-]{3,15})\b/gi,
    /\b([A-Z0-9][A-Z0-9-]{3,15})\b[\s,.:;!()-]{0,8}(?:is\s+(?:your|the)\s+)?(?:verification|security|confirmation|login|one[ -]?time)?\s*(?:code|passcode|otp)\b/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const candidate = match[1].replace(/[.,;!?]+$/g, "");
      if (/^\d{4,8}$/.test(candidate)) return candidate;
      if (/^[A-Z0-9-]{5,16}$/.test(candidate) && /\d/.test(candidate)) return candidate;
      if (/^[A-Z]{6,10}$/.test(candidate)) return candidate;
    }
  }
  for (const line of safeText(source).split(/\r?\n/).map((item) => item.trim())) {
    const candidate = line.match(/^[#:=\s]*([A-Z0-9][A-Z0-9-]{3,15})[.,;!?]*$/i)?.[1];
    if (/^\d{4,8}$/.test(candidate || "") || (/^[A-Z0-9-]{5,16}$/.test(candidate || "") && /\d/.test(candidate || "")) || /^[A-Z]{6,10}$/.test(candidate || "")) return candidate;
    const grouped = line.match(/^[#:=\s]*((?:\d{3,4}[ -])+\d{2,4})[.,;!?]*$/)?.[1]?.replace(/[ -]/g, "");
    if (/^\d{4,8}$/.test(grouped || "")) return grouped;
  }
  return "";
}

function normalizeCredentialLabel(value) {
  const label = safeText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(username|user name|login name|user|login)$/.test(label)) return "Username";
  if (/^(userid|user id|user number|user no|login id|account id|account number|account no|customer id|customer number|customer no|member id|member number|client id|client identifier|reference id|transaction id|order id|subscriber id)$/.test(label)) return "User ID";
  if (label === "id") return "ID";
  if (/^(password|passwd|pwd|passphrase|passcode)$/.test(label)) return label === "passcode" ? "Passcode" : "Password";
  if (/^(secret|client secret)$/.test(label)) return "Secret";
  if (/^(api key|secret key|access key|private key|public key|security key|recovery key|activation key|license key|authentication key|key)$/.test(label)) return "Key";
  if (/^(api token|access token|bearer token|session token|refresh token|auth token|jwt|token)$/.test(label)) return "Token";
  if (/^recovery codes?$/.test(label)) return "Recovery code";
  if (label === "recovery phrase") return "Recovery phrase";
  if (label === "serial number") return "Serial number";
  if (/^(email|e mail|email address|e mail address)$/.test(label)) return "Email";
  return "";
}

function detectCredentials(text, provided) {
  const found = new Map();
  const add = (label, value) => {
    const normalizedLabel = normalizeCredentialLabel(label);
    const safeValue = safeText(value).trim().replace(/^["'`]+|["'`,;]+$/g, "").slice(0, 500);
    const ignored = new Set(["is", "was", "your", "the", "below", "above", "here", "required", "shown", "listed", "provided", "sent", "available", "username", "user", "userid", "password", "passcode", "token", "key", "email"]);
    if (!normalizedLabel || !safeValue || ignored.has(safeValue.toLowerCase())) return;
    found.set(`${normalizedLabel}|${safeValue}`, { label: normalizedLabel, value: safeValue });
  };

  if (Array.isArray(provided)) {
    for (const entry of provided) {
      if (entry && typeof entry === "object") add(entry.label || entry.name || entry.type, entry.value || entry.secret || entry.token || entry.code);
    }
  } else if (provided && typeof provided === "object") {
    for (const [label, value] of Object.entries(provided)) {
      if (typeof value === "string" || typeof value === "number") add(label, value);
      else if (value && typeof value === "object") add(label, value.value || value.secret || value.token || value.code);
    }
  }

  const labels = "username|user\\s*name|user\\s*id|userid|login\\s*id|login|account\\s*(?:id|number)|customer\\s*(?:id|number)|member\\s*id|client\\s*id|reference\\s*id|transaction\\s*id|order\\s*id|user|id|password|passphrase|passcode|api\\s*(?:key|token)|secret\\s*key|client\\s*secret|secret|access\\s*(?:key|token)|private\\s*key|recovery\\s*(?:key|code|phrase)|activation\\s*key|license\\s*key|serial\\s*number|authentication\\s*key|key|token|email(?:\\s*address)?";
  const patterns = [
    new RegExp(`\\b(${labels})\\b\\s*(?::|=|-|\\bis\\b)\\s*[:=]?\\s*([^\\s,;|<>]{2,})`, "gi"),
    new RegExp(`\\b(${labels})\\b\\s*\\n\\s*([^\\s,;|<>]{2,})`, "gi"),
    new RegExp(`(?:^|\\n)\\s*(${labels})\\s{1,4}(?!is\\b)([^\\s,;|<>]{2,})`, "gim")
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) add(match[1], match[2]);
  }
  return Array.from(found.values());
}

function collectLinkItems(value, fallbackLabel = "Link") {
  if (typeof value === "string") {
    if (/^[\[{]/.test(value.trim())) {
      try { return collectLinkItems(JSON.parse(value), fallbackLabel); } catch { /* This may be an ordinary URL. */ }
    }
    return [{ url: value, label: fallbackLabel }];
  }
  if (Array.isArray(value)) return value.slice(0, 30).flatMap((item) => collectLinkItems(item, fallbackLabel));
  if (!value || typeof value !== "object") return [];
  const url = value.url || value.href || value.link || value.link_url || value.linkUrl || value.web_url || value.view_url || value.preview_url || value.permalink || value.download || value.download_url || value.downloadUrl || value.download_link || value.attachment_link || value.attachment_url || value.attachmentUrl || value.file_link || value.file_url || value.fileUrl || value.shared_link || value.share_link || value.share_url || value.shareUrl || value.public_link || value.public_url || value.publicUrl || value.direct_url;
  if (url) return [{ ...value, url, label: value.label || value.name || value.filename || value.file_name || fallbackLabel }];
  return Object.entries(value).slice(0, 30).flatMap(([label, item]) => collectLinkItems(item, label));
}

function analyzeMessage(message) {
  if (analysisCache.has(message)) return analysisCache.get(message);
  const body = bodyInfo(message);
  const subject = safeText(message.subject);
  const sourceText = `${subject}\n${body.text}`;
  const links = new Map();
  const addLink = (item, explicit = false, forceAttachment = false) => {
    const rawUrl = typeof item === "string" ? item : item?.url || item?.href || item?.link || item?.link_url || item?.linkUrl || item?.web_url || item?.view_url || item?.preview_url || item?.permalink || item?.download || item?.download_url || item?.downloadUrl || item?.download_link || item?.attachment_link || item?.attachment_url || item?.attachmentUrl || item?.file_link || item?.file_url || item?.fileUrl || item?.shared_link || item?.share_link || item?.share_url || item?.shareUrl || item?.public_link || item?.public_url || item?.publicUrl || item?.direct_url;
    const url = normalizedUrl(rawUrl);
    if (!url) return;
    const previous = links.get(url);
    const label = safeText(typeof item === "object" ? item.label : "") || previous?.label || "Open link";
    const urlParts = new URL(url);
    const contextIndex = sourceText.toLowerCase().indexOf(url.toLowerCase());
    const textContext = contextIndex < 0 ? "" : sourceText.slice(Math.max(0, contextIndex - 130), contextIndex + url.length + 130);
    const context = `${safeText(item?.context)} ${textContext}`;
    const pathAndQuery = `${urlParts.pathname}${urlParts.search}`;
    links.set(url, {
      url,
      label,
      explicit: explicit || Boolean(item?.explicit) || Boolean(previous?.explicit),
      markedVerification: Boolean(item?.is_verification || item?.isVerification || previous?.markedVerification),
      isAttachment: forceAttachment || Boolean(item?.is_attachment || item?.isAttachment || previous?.isAttachment) || ATTACHMENT_CONTEXT.test(`${label} ${pathAndQuery} ${context}`) || ATTACHMENT_EXTENSION.test(`${pathAndQuery} ${label}`) || FILE_SHARE_HOST.test(urlParts.hostname) || SHARE_PATH.test(pathAndQuery)
    });
  };

  for (const [list, label] of [[message.verification_links, "Verification link"], [message.verificationLinks, "Verification link"], [message.verification_links_json, "Verification link"], [message.links, "Link"], [message.links_json, "Link"], [message.detected_links, "Link"], [message.detected_links_json, "Link"]]) {
    for (const item of collectLinkItems(list, label)) addLink(item, label === "Verification link" || item.explicit, item.is_attachment || item.isAttachment);
  }
  for (const item of collectLinkItems([message.verification_link, message.verification_url, message.confirmation_link, message.verificationLink], "Verification link")) addLink(item, true);
  for (const source of [message.attachment, message.attachment_link, message.attachment_links, message.attachmentLinks, message.attachments, message.attachments_json, message.attachment_url, message.attachmentUrl, message.attachment_urls, message.attachmentUrls, message.file_link, message.file_links, message.fileLinks, message.file_url, message.fileUrl, message.file_urls, message.fileUrls, message.download_link, message.download_links, message.downloadLinks, message.download_url, message.downloadUrl, message.shared_file, message.shared_files, message.shared_link, message.shared_links, message.sharedLinks, message.shared_urls, message.sharedUrls, message.share_link, message.share_links, message.shareLinks, message.share_url, message.shareUrl, message.public_links, message.publicLinks, message.resource_links, message.resourceLinks, message.files, message.documents]) {
    for (const item of collectLinkItems(source, "Attachment")) addLink(item, false, true);
  }
  body.links.forEach((item) => addLink(item));
  const urlPattern = /https?:\/\/[^\s<>{}"']+/gi;
  let urlMatch;
  while ((urlMatch = urlPattern.exec(sourceText))) addLink(urlMatch[0]);

  const allLinks = Array.from(links.values()).slice(0, 20);
  const bodyLinkUrls = new Set(body.links.map((item) => normalizedUrl(item.url)).filter(Boolean));
  const bodyUrlPattern = /https?:\/\/[^\s<>{}"']+/gi;
  let bodyUrlMatch;
  while ((bodyUrlMatch = bodyUrlPattern.exec(body.text))) {
    const bodyUrl = normalizedUrl(bodyUrlMatch[0]);
    if (bodyUrl) bodyLinkUrls.add(bodyUrl);
  }
  const verifyContext = /\b(?:verif(?:y|ication)|confirm(?:ation)?|activat(?:e|ion)|sign[ -]?in|log[ -]?in|magic link|reset (?:your )?password|authenticate|one[ -]?time|security check)\b/i.test(sourceText);
  let verificationLinks = allLinks.filter((link) => link.explicit || link.markedVerification || /(?:verify|verification|confirm|confirmation|activate|activation|magic[/-]?link|reset[-_/]?(?:password|credential)|authenticate|one[-_/]?time)/i.test(`${link.label} ${link.url}`));
  if (!verificationLinks.length && verifyContext) {
    const contextualVerificationLink = allLinks.find((link) => !link.isAttachment);
    if (contextualVerificationLink) verificationLinks = [contextualVerificationLink];
  }
  const attachmentLinks = allLinks.filter((link) => link.isAttachment && !verificationLinks.includes(link));
  const otherLinks = allLinks.filter((link) => !verificationLinks.includes(link) && !attachmentLinks.includes(link));

  const explicitCode = safeText(message.verification_code || message.verificationCode || message.otp || message.otp_code || message.one_time_code || message.security_code || message.code);
  const code = detectCode(sourceText, explicitCode);
  const credentials = detectCredentials(sourceText, message.detected_credentials || message.credentials || message.login_details || message.access_details || message.account_details);
  const credentialLabels = Array.from(new Set([
    ...(Array.isArray(message.credential_labels) ? message.credential_labels : []),
    ...credentials.map((item) => item.label)
  ].map(normalizeCredentialLabel).filter(Boolean)));
  const hasCredentialSignal = Boolean(message.has_credentials) || credentials.length > 0 || /\b(?:username|user(?:name|\s*id)?|login(?:\s*id)?|account\s*(?:id|number)|customer\s*id|member\s*id|id\s*[:=]|password\s*[:=]|passphrase|passcode|(?:api|client|secret|access|private|recovery|activation|license)?\s*(?:key|token|secret)\s*[:=]|recovery\s*(?:code|phrase)|serial\s*number)\b/i.test(sourceText);
  const result = {
    body: body.text,
    code,
    hasCodeSignal: Boolean(code || message.has_code || message.hasCode),
    links: allLinks,
    bodyHtml: body.html,
    bodyLinkUrls,
    verificationLinks,
    attachmentLinks,
    otherLinks,
    hasLinkSignal: Boolean(message.has_links || message.link_count || allLinks.length || message.verification_link_count),
    hasAttachmentSignal: Boolean(message.has_attachments || message.attachment_link_count || attachmentLinks.length),
    credentials,
    credentialLabels,
    hasCredentialSignal
  };
  analysisCache.set(message, result);
  return result;
}

function setStatus(message, state = "good") {
  statusElement.textContent = message;
  statusIndicator.className = `sync-indicator${state === "syncing" ? " is-syncing" : state === "error" ? " is-error" : ""}`;
  $("statusRow").classList.toggle("has-error", state === "error");
}

function updateSyncTime() {
  if (!lastUpdatedAt) return;
  const time = lastUpdatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
  $("footerUpdated").textContent = `Last checked ${time}`;
}

function updateSummary() {
  const messages = getCurrentMessages();
  const unread = unreadCount(messages);
  $("inboxTotal").textContent = String(ADDRESSES.length).padStart(2, "0");
  $("unreadBadge").textContent = `${unread} unread`;
  $("inboxTitle").textContent = selectedMailbox === "all" ? "All inboxes" : selectedMailbox.split("@")[0];
  $("selectedAddress").textContent = selectedMailbox === "all" ? "The latest from all your addresses." : selectedMailbox;
  $("mailboxCurrentAddress").textContent = selectedMailbox === "all"
    ? `Latest from all ${ADDRESSES.length} connected addresses`
    : selectedMailbox;
  $("markAllRead").hidden = unread === 0 || messages.length === 0;
}

function populateMobileMailbox() {
  const fragment = document.createDocumentFragment();
  const all = makeElement("option", "", "All inboxes");
  all.value = "all";
  fragment.appendChild(all);
  for (const address of ADDRESSES) {
    const option = makeElement("option", "", address);
    option.value = address;
    fragment.appendChild(option);
  }
  mobileMailbox.replaceChildren(fragment);
  mobileMailbox.value = selectedMailbox;
}

function renderMailboxList() {
  mailboxList.replaceChildren();
  const allMessages = getAllCachedMessages();
  const entries = [{ value: "all", label: "All inboxes", icon: "inbox", messages: allMessages }]
    .concat(ADDRESSES.map((address) => ({
      value: address,
      label: address,
      icon: "mail",
      messages: messagesByInbox.get(address) || []
    })));

  for (const entry of entries) {
    const button = makeElement("button", `mailbox-item${selectedMailbox === entry.value ? " is-selected" : ""}`);
    button.type = "button";
    button.dataset.mailbox = entry.value;
    if (selectedMailbox === entry.value) button.setAttribute("aria-current", "page");
    const iconWrap = makeElement("span", "mailbox-icon");
    iconWrap.appendChild(makeIcon(entry.icon));
    const label = makeElement("span", "mailbox-label", entry.label);
    if (entry.value !== "all") {
      label.title = entry.value;
      button.setAttribute("aria-label", `Open inbox ${entry.value}`);
    }
    const count = makeElement("span", `mailbox-count${unreadCount(entry.messages) ? " has-unread" : ""}`, String(unreadCount(entry.messages)));
    button.append(iconWrap, label, count);
    mailboxList.appendChild(button);
  }
  mobileMailbox.value = selectedMailbox;
}

function createCopyButton(value, label = "Copy") {
  const button = makeElement("button", "copy-button");
  button.type = "button";
  button.dataset.copyValue = value;
  button.append(makeIcon("copy"), makeElement("span", "", label));
  return button;
}

function addDetailRow(container, label, value) {
  const row = makeElement("div", "detail-row");
  row.append(makeElement("span", "detail-label", label), makeElement("span", "detail-value", value || "—"));
  container.appendChild(row);
}

function createOpenLink(link, isVerification, isAttachment = false) {
  const anchor = makeElement("a", "open-link-button");
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.referrerPolicy = "no-referrer";
  anchor.append(makeIcon("external"), makeElement("span", "", isVerification ? "Open verification link" : isAttachment ? "Open file link" : "Open link"));
  return anchor;
}

function createTypeBadge(type, label, icon) {
  const badge = makeElement("span", `type-badge type-${type}`);
  if (icon) badge.appendChild(makeIcon(icon));
  badge.appendChild(makeElement("span", "", label));
  return badge;
}

function createMessageCard(message, index, animateArrival = false) {
  const key = messageKey(message);
  const isRead = readMessageKeys.has(key);
  const isOpen = openMessages.has(key);
  const analysis = analyzeMessage(message);
  const sender = safeText(message.sender, "Unknown sender");
  const subject = safeText(message.subject, "(No subject)");
  const attachmentCount = Math.max(analysis.attachmentLinks.length, Number(message.attachment_link_count || 0), analysis.hasAttachmentSignal ? 1 : 0);
  const otherLinkCount = Math.max(analysis.otherLinks.length, Number(message.link_count || 0) - Number(message.verification_link_count || 0) - Number(message.attachment_link_count || 0));
  const preview = analysis.body
    ? analysis.body.replace(/\s+/g, " ").slice(0, 145)
    : analysis.code ? `Verification code ready · ${analysis.code}`
      : analysis.hasAttachmentSignal ? `${attachmentCount} shared file link${attachmentCount === 1 ? "" : "s"} detected.`
      : analysis.verificationLinks.length ? "A verification link is ready to open."
        : message.verification_link_count ? "Verification link detected. Open this message to load it."
          : analysis.hasCodeSignal ? "Verification code detected. Sync to load it."
          : analysis.hasCredentialSignal ? "Sign-in details detected in this message."
          : "Open this message to view its details.";

  const card = makeElement("article", `message-card${isRead ? " is-read" : " is-unread"}${isOpen ? " is-open" : ""}${animateArrival ? " is-entering" : ""}`);
  card.dataset.key = key;
  const main = makeElement("button", "message-main");
  main.type = "button";
  main.dataset.action = "open";
  main.dataset.key = key;
  main.setAttribute("aria-expanded", String(isOpen));
  main.setAttribute("aria-label", `${isRead ? "Read" : "Unread"} message from ${sender}: ${subject}`);

  const avatar = makeElement("span", "sender-avatar", initials(sender));
  const summary = makeElement("span", "message-summary");
  const senderLine = makeElement("span", "sender-line");
  senderLine.append(makeElement("strong", "sender-name", sender), makeElement("span", "message-time", formatCompactDate(message.received_at)));
  summary.append(senderLine, makeElement("span", "subject-line", subject), makeElement("span", "preview-line", preview));
  const unreadDot = makeElement("span", "unread-dot");
  unreadDot.setAttribute("aria-hidden", "true");
  main.append(avatar, summary, unreadDot, makeIcon("chevron", "icon open-chevron"));
  card.appendChild(main);

  const tags = makeElement("div", "message-tags");
  if (analysis.hasCodeSignal) {
    tags.append(createTypeBadge("code", "Code detected", "check"));
    if (analysis.code) tags.appendChild(createCopyButton(analysis.code, "Copy code"));
  }
  if (analysis.verificationLinks.length) {
    tags.append(createTypeBadge("link", "Verification link", "link"), createOpenLink(analysis.verificationLinks[0], true));
    if (analysis.verificationLinks.length > 1) tags.appendChild(makeElement("span", "result-count", `+${analysis.verificationLinks.length - 1} more`));
  } else if (message.verification_link_count) {
    tags.appendChild(createTypeBadge("link", "Verification link", "link"));
  }
  if (analysis.attachmentLinks.length) {
    tags.appendChild(createTypeBadge("attachment", `${analysis.attachmentLinks.length} file link${analysis.attachmentLinks.length === 1 ? "" : "s"}`, "external"));
    if (analysis.attachmentLinks.length > 1) tags.appendChild(makeElement("span", "result-count", `+${analysis.attachmentLinks.length - 1} more`));
  } else if (analysis.hasAttachmentSignal) {
    tags.appendChild(createTypeBadge("attachment", `${message.attachment_link_count || "File"} link${Number(message.attachment_link_count || 0) === 1 ? "" : "s"}`, "external"));
  }
  if (otherLinkCount > 0 || (analysis.hasLinkSignal && !message.verification_link_count && !attachmentCount)) {
    const displayedOtherCount = otherLinkCount || 1;
    tags.appendChild(createTypeBadge("link", `${displayedOtherCount} other link${displayedOtherCount === 1 ? "" : "s"}`, "link"));
  }
  if (analysis.hasCredentialSignal) tags.appendChild(createTypeBadge("credentials", "Access details", "key"));
  if (!analysis.hasCodeSignal && !analysis.hasLinkSignal && !analysis.hasCredentialSignal) tags.appendChild(createTypeBadge("message", "Regular message", "mail"));
  const readButton = makeElement("button", "read-toggle", isRead ? "Mark unread" : "Mark read");
  readButton.type = "button";
  readButton.dataset.action = "toggle-read";
  readButton.dataset.key = key;
  tags.appendChild(readButton);
  card.appendChild(tags);

  if (isOpen) card.appendChild(createMessageDetails(message, analysis));
  card.dataset.renderSignature = renderSignature(message, analysis, isRead, isOpen);
  if (animateArrival) card.addEventListener("animationend", () => card.classList.remove("is-entering"), { once: true });
  return card;
}

function renderSignature(message, analysis, isRead, isOpen) {
  const source = [
    messageListSignature([message]), isRead, isOpen, message.body_loading, message.body_loaded,
    message.body_error, analysis.body, analysis.bodyHtml,
    analysis.credentials.map((item) => `${item.label}:${item.value}`).join("|"),
    analysis.links.map((item) => `${item.url}:${item.label}:${item.isAttachment}:${item.explicit}`).join("|")
  ].join("\u001d");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function createMessageDetails(message, analysis) {
  const details = makeElement("div", "message-details");
  const metadata = makeElement("div", "message-metadata");
  addDetailRow(metadata, "From", safeText(message.sender, "Unknown sender"));
  addDetailRow(metadata, "To", safeText(message.recipient, "Unknown recipient"));
  addDetailRow(metadata, "Received", formatDate(message.received_at));
  details.appendChild(metadata);

  const appendLinkSection = (title, links, kind, fallbackCount = 0) => {
    const count = Math.max(links.length, Number(fallbackCount) || 0);
    const inlineKeys = analysis.bodyLinkUrls || new Set();
    const visibleLinks = links.filter((link) => !inlineKeys.has(link.url));
    const alreadyInline = links.length - visibleLinks.length;
    const remainingCount = Math.max(visibleLinks.length, count - alreadyInline);
    if (!remainingCount) return;
    const section = makeElement("section", "detail-section");
    section.appendChild(makeElement("h3", "detail-section-title", title));
    const list = makeElement("div", "link-list");
    for (const link of visibleLinks) {
      const row = makeElement("div", "detected-link");
      const copy = makeElement("div", "detected-link-copy");
      let hostAndPath = link.url;
      try { const parsed = new URL(link.url); hostAndPath = `${parsed.hostname}${parsed.pathname}`; } catch { /* Keep the original safe URL. */ }
      copy.append(makeElement("strong", "", link.label || (kind === "attachment" ? "Shared file" : "Email link")), makeElement("span", "", hostAndPath));
      row.append(copy, createCopyButton(link.url, "Copy link"), createOpenLink(link, kind === "verification", kind === "attachment"));
      list.appendChild(row);
    }
    if (!visibleLinks.length) list.appendChild(makeElement("p", "link-hint", message.body_loading ? "Loading link details…" : message.body_error ? "Could not load link details while offline. Try again when connected." : "Additional links were detected, but their full details are unavailable."));
    section.appendChild(list);
    details.appendChild(section);
  };

  const savedVerificationCount = Math.max(analysis.verificationLinks.length, Number(message.verification_link_count || 0));
  const savedAttachmentCount = Math.max(analysis.attachmentLinks.length, Number(message.attachment_link_count || 0), analysis.hasAttachmentSignal ? 1 : 0);
  const savedTotalLinkCount = Math.max(analysis.links.length, Number(message.link_count || 0), analysis.hasLinkSignal ? 1 : 0);
  const savedOtherCount = Math.max(analysis.otherLinks.length, savedTotalLinkCount - savedVerificationCount - savedAttachmentCount);
  if (message.body_available !== true || message.body_loaded) {
    appendLinkSection("Verification links", analysis.verificationLinks, "verification", savedVerificationCount);
    appendLinkSection("Attachment & shared file links", analysis.attachmentLinks, "attachment", savedAttachmentCount);
    appendLinkSection("Other links", analysis.otherLinks, "other", savedOtherCount);
  }

  if (analysis.code) {
    const section = makeElement("section", "detail-section");
    section.appendChild(makeElement("h3", "detail-section-title", "Verification code"));
    const codeRow = makeElement("div", "detail-code");
    codeRow.append(makeElement("strong", "detail-code-value", analysis.code), createCopyButton(analysis.code, "Copy code"));
    section.appendChild(codeRow);
    details.appendChild(section);
  } else if (analysis.hasCodeSignal) {
    details.appendChild(makeElement("p", "credential-hint", message.body_loading ? "Verification code detected. Loading it…" : "Verification code detected. Sync while online to load it."));
  }

  if (analysis.credentials.length) {
    const section = makeElement("section", "detail-section");
    section.appendChild(makeElement("h3", "detail-section-title", "Detected account & access details"));
    const list = makeElement("div", "credential-list");
    for (const item of analysis.credentials) {
      const row = makeElement("div", "credential-item");
      row.append(makeElement("strong", "credential-label", item.label), makeElement("code", "credential-value", item.value), createCopyButton(item.value, "Copy"));
      list.appendChild(row);
    }
    section.appendChild(list);
    details.appendChild(section);
  } else if (analysis.credentialLabels.length) {
    const labels = analysis.credentialLabels.join(", ");
    const hint = message.body_loading
      ? `Detected ${labels}. Loading values…`
      : message.body_error
        ? `Detected ${labels}, but their values could not be loaded. Try opening this message again.`
        : message.body_loaded || message.body_available === false
          ? `Detected ${labels}, but the mail source did not provide their values.`
          : `Detected ${labels}. Open this message to load the values.`;
    details.appendChild(makeElement("p", "credential-hint", hint));
  } else if (analysis.hasCredentialSignal) {
    details.appendChild(makeElement("p", "credential-hint", "This message mentions sign-in details, but no labelled value could be extracted."));
  }

  const bodySection = makeElement("section", "detail-section body-section");
  bodySection.appendChild(makeElement("h3", "detail-section-title", "Message"));
  const bodyText = analysis.body || (message.body_loading ? "Loading the full message…" : message.body_error ? "Could not load the message body. Try opening it again." : message.body_available === false ? "The mail source only provided sender, subject, and received time." : message.body_loaded ? "No readable text was included in this message." : "Loading the full message…");
  bodySection.appendChild(renderEmailBody(analysis.bodyHtml, bodyText, message.body_loading && !analysis.body));
  details.appendChild(bodySection);
  return details;
}

function matchesFilter(message) {
  const isRead = readMessageKeys.has(messageKey(message));
  if (activeFilter === "unread") return !isRead;
  if (activeFilter === "read") return isRead;
  const analysis = analyzeMessage(message);
  if (activeFilter === "codes") return analysis.hasCodeSignal;
  if (activeFilter === "links") return analysis.hasLinkSignal;
  if (activeFilter === "attachments") return analysis.hasAttachmentSignal;
  if (activeFilter === "credentials") return analysis.hasCredentialSignal;
  if (activeFilter === "other") return !analysis.hasCodeSignal && !analysis.hasLinkSignal && !analysis.hasCredentialSignal;
  return true;
}

function renderMessages() {
  const allMessages = getCurrentMessages();
  const query = searchInput.value.trim().toLowerCase();
  const visible = allMessages.filter((message) => {
    if (!matchesFilter(message)) return false;
    if (!query) return true;
    const analysis = analyzeMessage(message);
    return [message.sender, message.recipient, message.subject, message.received_at, analysis.code, analysis.body,
      ...analysis.credentials.map((item) => `${item.label} ${item.value}`), ...analysis.credentialLabels,
      ...analysis.links.map((link) => `${link.label} ${link.url}`)]
      .map((value) => safeText(value).toLowerCase()).join(" ").includes(query);
  });

  countElement.textContent = visible.length === allMessages.length
    ? `${allMessages.length} message${allMessages.length === 1 ? "" : "s"}`
    : `${visible.length} of ${allMessages.length}`;

  if (!visible.length) {
    const empty = makeElement("div", "empty-state");
    const searching = Boolean(query) || activeFilter !== "all";
    const icon = activeFilter === "links" ? "link" : activeFilter === "attachments" ? "external" : activeFilter === "credentials" ? "key" : searching ? "search" : "inbox";
    const emptyIcon = makeElement("span", "empty-icon");
    emptyIcon.appendChild(makeIcon(icon));
    const title = initialSyncComplete ? (searching ? "Nothing matches this view" : "Your inbox is clear") : "Checking your recent mail";
    const copy = initialSyncComplete
      ? (searching ? "Try another filter or search term." : "New messages will appear here as soon as they arrive.")
      : "Getting messages from your connected addresses…";
    empty.append(emptyIcon, makeElement("h3", "", title), makeElement("p", "", copy));
    messagesElement.replaceChildren(empty);
  } else {
    const existing = new Map(Array.from(messagesElement.children)
      .filter((node) => node.classList.contains("message-card"))
      .map((node) => [node.dataset.key, node]));
    let position = 0;
    for (const [index, message] of visible.entries()) {
      const key = messageKey(message);
      const oldCard = existing.get(key);
      const analysis = analyzeMessage(message);
      const signature = renderSignature(message, analysis, readMessageKeys.has(key), openMessages.has(key));
      const card = oldCard?.dataset.renderSignature === signature
        ? oldCard
        : createMessageCard(message, index, !oldCard && arrivalKeys.has(key));
      arrivalKeys.delete(key);
      existing.delete(key);
      const atPosition = messagesElement.children[position] || null;
      if (atPosition !== card) messagesElement.insertBefore(card, atPosition);
      position++;
    }
    for (const card of existing.values()) card.remove();
    while (messagesElement.children.length > position) messagesElement.lastElementChild.remove();
  }
  updateSummary();
}

async function fetchInbox(recipient) {
  const url = new URL(API_URL, window.location.origin);
  url.searchParams.set("recipient", recipient);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = response.status === 404
        ? "Inbox API not found · deploy this page with its Netlify Function to load mail."
        : data.error || `Inbox service returned ${response.status}`;
      throw new Error(reason);
    }
    if (!data || !Array.isArray(data.messages)) throw new Error("Inbox service returned an invalid response.");
    return data;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadMessageBody(message) {
  if (message.body_text || message.body_loaded || !message.id || !ADDRESSES.includes(safeText(message.recipient).toLowerCase())) return;
  if (message.body_loading) return;
  message.body_loading = true;
  renderMessages();
  const url = new URL(API_URL, window.location.origin);
  url.searchParams.set("recipient", safeText(message.recipient).toLowerCase());
  url.searchParams.set("message_id", String(message.id));
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.message) throw new Error(data.error || "Could not load the message body.");
    Object.assign(message, data.message, { body_loaded: true, body_loading: false });
    analysisCache.delete(message);
  } catch (error) {
    message.body_loading = false;
    message.body_error = true;
    message.body_error_message = error.message;
  } finally {
    window.clearTimeout(timeout);
    if (openMessages.has(messageKey(message)) && getCurrentMessages().some((item) => messageKey(item) === messageKey(message))) renderMessages();
  }
}

function updateOneMailbox(address, messages) {
  const next = sortMessages(messages.slice());
  const previous = messagesByInbox.get(address) || [];
  const changed = messageListSignature(previous) !== messageListSignature(next);
  if (changed) {
    const previousByKey = new Map(previous.map((message) => [messageKey(message), message]));
    for (const message of next) {
      const key = messageKey(message);
      const cached = previousByKey.get(key);
      if (!cached && initialSyncComplete) {
        arrivalKeys.add(key);
        if (arrivalKeys.size > 100) arrivalKeys.delete(arrivalKeys.values().next().value);
      }
      if (cached) {
        for (const field of ["body_text", "body_html", "body_loaded", "body_loading", "body_error", "body_error_message"]) {
          if (cached[field] !== undefined) message[field] = cached[field];
        }
        if (cached.body_available) message.body_available = true;
      }
    }
    messagesByInbox.set(address, next);
  }
  return changed;
}

function saveInboxCache() {
  try {
    const messages = getAllCachedMessages().slice(0, CACHE_LIMIT).map((message) => {
      const analysis = analyzeMessage(message);
      return {
        id: message.id,
        sender: safeText(message.sender),
        recipient: safeText(message.recipient).toLowerCase(),
        subject: safeText(message.subject),
        received_at: safeText(message.received_at),
        body_available: Boolean(message.body_available),
        has_code: analysis.hasCodeSignal,
        has_credentials: analysis.hasCredentialSignal,
        credential_labels: analysis.credentialLabels,
        has_links: analysis.hasLinkSignal,
        has_attachments: analysis.hasAttachmentSignal,
        link_count: Number(message.link_count || message.links?.length || 0),
        verification_link_count: Number(message.verification_link_count || message.verification_links?.length || 0),
        attachment_link_count: Number(message.attachment_link_count || message.attachment_links?.length || 0)
      };
    });
    const savedAt = Date.now();
    sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify({ saved_at: savedAt, messages }));
    sessionStorage.setItem(CACHE_TIME_KEY, String(savedAt));
  } catch { /* Private browsing or a full storage area should not block the inbox. */ }
}

function hydrateInboxCache() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_STORAGE_KEY) || "null");
    const savedAt = Number(sessionStorage.getItem(CACHE_TIME_KEY) || cached?.saved_at);
    if (!cached || !Array.isArray(cached.messages) || !Number.isFinite(savedAt) || savedAt > Date.now() + 60000 || Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) return false;
    const groups = new Map(ADDRESSES.map((address) => [address, []]));
    for (const entry of cached.messages.slice(0, CACHE_LIMIT)) {
      const recipient = safeText(entry.recipient).toLowerCase();
      if (!groups.has(recipient) || !entry.id) continue;
      groups.get(recipient).push({
        id: entry.id,
        sender: safeText(entry.sender, "Unknown sender"),
        recipient,
        subject: safeText(entry.subject, "(No subject)"),
        received_at: safeText(entry.received_at),
        body_available: Boolean(entry.body_available),
        has_code: Boolean(entry.has_code),
        has_credentials: Boolean(entry.has_credentials),
        credential_labels: Array.isArray(entry.credential_labels) ? entry.credential_labels : [],
        has_links: Boolean(entry.has_links),
        has_attachments: Boolean(entry.has_attachments),
        link_count: Number(entry.link_count || 0),
        verification_link_count: Number(entry.verification_link_count || 0),
        attachment_link_count: Number(entry.attachment_link_count || 0),
        is_cached_summary: true
      });
    }
    let count = 0;
    for (const [address, messages] of groups) {
      messagesByInbox.set(address, sortMessages(messages));
      count += messages.length;
    }
    if (!count) return false;
    initialSyncComplete = true;
    lastUpdatedAt = new Date(savedAt);
    updateSyncTime();
    setStatus("Showing saved inbox · checking for new mail", "syncing");
    renderMailboxList();
    renderMessages();
    return true;
  } catch { return false; }
}

function updateAllFromMailboxes() {
  const unique = new Map();
  for (const address of ADDRESSES) {
    for (const message of messagesByInbox.get(address) || []) unique.set(messageKey(message), message);
  }
  return sortMessages(Array.from(unique.values()));
}

function formatSyncTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

async function loadInboxes({ quiet = false } = {}) {
  if (isLoading) {
    if (!quiet) queuedManualRefresh = true;
    return;
  }
  isLoading = true;
  if (!quiet) {
    refreshButtons.forEach((button) => { button.disabled = true; button.classList.add("is-loading"); });
    setStatus("Syncing your inbox…", "syncing");
  }

  try {
    const mailboxAtRequest = selectedMailbox;
    const data = await fetchInbox(mailboxAtRequest);
    const refreshed = Array.isArray(data.refreshed) ? data.refreshed.filter((address) => ADDRESSES.includes(address)) : [mailboxAtRequest];
    const failed = Array.isArray(data.failed) ? data.failed : [];
    let changed = false;

    if (mailboxAtRequest === "all") {
      const groups = new Map(ADDRESSES.map((address) => [address, []]));
      for (const message of data.messages) {
        const recipient = safeText(message.recipient).toLowerCase();
        if (groups.has(recipient)) groups.get(recipient).push(message);
      }
      for (const address of refreshed) changed = updateOneMailbox(address, groups.get(address) || []) || changed;
    } else if (refreshed.includes(mailboxAtRequest) || !data.refreshed) {
      changed = updateOneMailbox(mailboxAtRequest, data.messages) || changed;
    }

    if (!refreshed.length && failed.length) throw new Error("Could not reach any selected inbox.");
    lastUpdatedAt = new Date();
    try { sessionStorage.setItem(CACHE_TIME_KEY, String(lastUpdatedAt.getTime())); } catch { /* The current session remains usable without saved sync time. */ }
    failureCount = 0;
    initialSyncComplete = true;
    updateSyncTime();
    if (changed) saveInboxCache();
    if (changed) {
      renderMailboxList();
      renderMessages();
      setStatus(failed.length ? `Updated ${refreshed.length} inboxes · ${failed.length} unavailable` : "New mail synced", failed.length ? "error" : "good");
    } else if (!quiet) {
      renderMailboxList();
      renderMessages();
      setStatus(failed.length ? `Some inboxes could not be reached (${failed.length}).` : `Up to date · ${formatSyncTime(lastUpdatedAt)}`, failed.length ? "error" : "good");
    } else if (failed.length) {
      setStatus(`Some inboxes could not be reached (${failed.length}).`, "error");
    }
  } catch (error) {
    failureCount++;
    initialSyncComplete = true;
    setStatus(error.message || "Could not sync your inbox.", "error");
    renderMailboxList();
    renderMessages();
  } finally {
    isLoading = false;
    refreshButtons.forEach((button) => { button.disabled = false; button.classList.remove("is-loading"); });
    if (queuedManualRefresh) {
      queuedManualRefresh = false;
      window.setTimeout(() => loadInboxes({ quiet: false }), 0);
    } else {
      scheduleAutoSync();
    }
  }
}

function scheduleAutoSync() {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!autoRefresh.checked || document.hidden) return;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const slowConnection = connection && (connection.saveData || /^(slow-2g|2g)$/.test(connection.effectiveType || "") || Number(connection.rtt) > 1200);
  const interval = slowConnection ? Math.max(REFRESH_MS, 30000) : REFRESH_MS;
  const backoff = failureCount ? Math.min(interval * (2 ** Math.min(failureCount, 3)), MAX_BACKOFF_MS) : interval;
  refreshTimer = window.setTimeout(() => loadInboxes({ quiet: true }), backoff);
}

async function copyText(value, button) {
  const label = button.querySelector("span");
  const original = label ? label.textContent : "Copy";
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const temporary = document.createElement("textarea");
      temporary.value = value;
      temporary.setAttribute("readonly", "");
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.appendChild(temporary);
      temporary.select();
      const copied = document.execCommand("copy");
      temporary.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    if (label) label.textContent = "Copied";
    button.classList.add("is-copied");
  } catch {
    if (label) label.textContent = "Copy failed";
    button.classList.add("is-error");
  } finally {
    window.setTimeout(() => {
      if (label && label.isConnected) label.textContent = original;
      button.classList.remove("is-copied", "is-error");
    }, 1500);
  }
}

function chooseMailbox(value) {
  if (value !== "all" && !ADDRESSES.includes(value)) return;
  const changed = value !== selectedMailbox;
  selectedMailbox = value;
  mobileMailbox.value = value;
  if (value === "all") {
    activeFilter = "all";
    searchInput.value = "";
    for (const chip of $("filterBar").querySelectorAll("[data-filter]")) {
      const active = chip.dataset.filter === "all";
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-selected", String(active));
    }
  }
  renderMailboxList();
  renderMessages();
  if (changed || value === "all") loadInboxes({ quiet: false });
}

mailboxList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("button[data-mailbox]");
  if (button && mailboxList.contains(button)) chooseMailbox(button.dataset.mailbox);
});
mobileMailbox.addEventListener("change", () => chooseMailbox(mobileMailbox.value));
refreshButtons.forEach((button) => button.addEventListener("click", () => loadInboxes({ quiet: false })));
autoRefresh.addEventListener("change", () => {
  if (autoRefresh.checked) {
    setStatus("Adaptive auto sync is on", "good");
    scheduleAutoSync();
  } else {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    setStatus("Auto sync paused", "good");
  }
});

$("filterBar").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  for (const chip of $("filterBar").querySelectorAll("[data-filter]")) {
    const active = chip === button;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-selected", String(active));
  }
  renderMessages();
});

searchInput.addEventListener("input", () => {
  if (searchRenderTimer !== null) window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(renderMessages, 90);
});

messagesElement.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-copy-value]");
  if (copyButton) {
    event.stopPropagation();
    copyText(copyButton.dataset.copyValue, copyButton);
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const key = action.dataset.key;
  if (action.dataset.action === "open") {
    if (openMessages.has(key)) openMessages.delete(key);
    else {
      openMessages.add(key);
      readMessageKeys.add(key);
      saveReadState();
    }
  } else if (action.dataset.action === "toggle-read") {
    if (readMessageKeys.has(key)) {
      readMessageKeys.delete(key);
      openMessages.delete(key);
    } else {
      readMessageKeys.add(key);
    }
    saveReadState();
  }
  renderMailboxList();
  renderMessages();
  if (action.dataset.action === "open" && openMessages.has(key)) {
    const message = getCurrentMessages().find((item) => messageKey(item) === key);
    if (message) loadMessageBody(message);
  }
});

$("markAllRead").addEventListener("click", () => {
  for (const message of getCurrentMessages()) readMessageKeys.add(messageKey(message));
  saveReadState();
  renderMailboxList();
  renderMessages();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
  } else if (autoRefresh.checked) {
    loadInboxes({ quiet: true });
  }
});
window.addEventListener("online", () => loadInboxes({ quiet: true }));
const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
networkInfo?.addEventListener?.("change", scheduleAutoSync);
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    renderMessages();
    searchInput.blur();
  }
});

populateMobileMailbox();
$("mailApp").hidden = false;
hydrateInboxCache();
renderMailboxList();
renderMessages();
loadInboxes({ quiet: false });
