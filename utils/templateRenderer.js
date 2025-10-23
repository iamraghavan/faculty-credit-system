// utils/templateRenderer.js
'use strict';

/**
 * Escape HTML to prevent injection
 */
function escapeHtml(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * renderTemplate(templateString, model)
 * Replaces occurrences of {{key}} with model[key] (string). Safe escape already applied by caller.
 * For convenience, we also allow {{{key}}} to insert unescaped HTML (use sparingly).
 */
function renderTemplate(template, model = {}) {
  // Replace triple-stash {{{key}}} with raw model value (use carefully)
  template = template.replace(/\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}/g, (m, key) => {
    const val = getPath(model, key);
    return val == null ? '' : String(val);
  });

  // Replace double-stash {{key}} with escaped value
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, key) => {
    const val = getPath(model, key);
    return val == null ? '' : String(val);
  });
}

function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const p of parts) {
    if (current == null) return undefined;
    current = current[p];
  }
  return current;
}

module.exports = { escapeHtml, renderTemplate };
