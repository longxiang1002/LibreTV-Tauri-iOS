// Broader Tauri environment detection
function isLikelyTauriEnvironment() {
    if (typeof window !== 'undefined') {
        // Log individual checks for better debugging
        // console.log('[EnvCheck] window.__TAURI_IPC__:', !!window.__TAURI_IPC__);
        // console.log('[EnvCheck] window.__TAURI_METADATA__:', !!window.__TAURI_METADATA__);
        // console.log('[EnvCheck] window.__TAURI__:', !!window.__TAURI__);
        // console.log('[EnvCheck] window.location.protocol:', window.location.protocol);
        // console.log('[EnvCheck] window.location.hostname:', window.location.hostname);
        // console.log('[EnvCheck] navigator.userAgent:', navigator.userAgent);

        if (!!window.__TAURI_IPC__ || !!window.__TAURI_METADATA__ || !!window.__TAURI__) return true;
        if (window.location.protocol === 'tauri:') return true;
        if (window.location.hostname === 'tauri.localhost') return true; 
        if (navigator.userAgent.includes("Tauri")) return true;
    }
    return false;
}

const tauriConstants = {
    get invoke() {
        if (typeof window !== 'undefined') {
            // Tauri v2+
            if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
                return window.__TAURI_INTERNALS__.invoke;
            }
            // Fallback for older Tauri versions or other structures if window.__TAURI__ is used
            if (window.__TAURI__ && typeof window.__TAURI__ === 'object') {
                if (typeof window.__TAURI__.invoke === 'function') { // Direct invoke on __TAURI__
                    return window.__TAURI__.invoke;
                }
                if (window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') { // v1 style
                    return window.__TAURI__.core.invoke;
                }
                if (window.__TAURI__.tauri && typeof window.__TAURI__.tauri.invoke === 'function') { // another v1 style
                    return window.__TAURI__.tauri.invoke;
                }
            }
        }
        return null;
    },
    TIMEOUT_SECS: 20, // Default timeout for Rust HTTP client & JS fetch fallback
};

// Helper for error construction
const createApiError = (message, statusCode) => {
    const err = new Error(message);
    if (statusCode) err.statusCode = statusCode;
    return err;
};

/**
 * 智能 API 地址拼接工具。
 * 兼容两种来源：
 *   1. 内置源：baseUrl 为纯域名（如 http://caiji.dyttzyapi.com）→ 拼接 API_CONFIG.search.path
 *   2. 订阅导入源：baseUrl 已含完整 API 路径（如 http://cj.ffzyapi.com/api.php/provide/vod）
 *      → 直接追加查询参数，避免路径重复导致 404
 */
function apiBaseHasFullPath(baseUrl) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    return /\/api\.php\/provide\/vod$/i.test(b) || /\/provide\/vod$/i.test(b);
}

function buildApiSearchUrl(baseUrl, query) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    const q = encodeURIComponent(query);
    if (apiBaseHasFullPath(b)) return `${b}/?ac=videolist&wd=${q}`;
    return `${b}${API_CONFIG.search.path}${q}`;
}

function buildApiPageUrl(baseUrl, query, page) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    const q = encodeURIComponent(query);
    if (apiBaseHasFullPath(b)) return `${b}/?ac=videolist&wd=${q}&pg=${page}`;
    return `${b}${API_CONFIG.search.pagePath.replace('{query}', q).replace('{page}', page)}`;
}

function buildApiDetailUrl(baseUrl, id) {
    const b = (baseUrl || '').trim().replace(/\/+$/, '');
    if (apiBaseHasFullPath(b)) return `${b}/?ac=videolist&ids=${encodeURIComponent(id)}`;
    return `${b}${API_CONFIG.detail.path}${id}`;
}
