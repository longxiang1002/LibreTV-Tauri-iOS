/**
 * LibreTV 订阅导入（LibreTV-SourceList v2 格式）
 * 支持：
 *   1. 订阅链接导入（自动走 Tauri Rust 代理，避免 CORS）
 *   2. 订阅 JSON 文本直接粘贴导入
 * 订阅结构：{ name, version, sources: [{name,url}], liveSources: [{name,url}] }
 * 导入后：点播源合并进 customAPIs 并自动勾选；直播源存入 localStorage 备用。
 */

const SUBSCRIPTION_LIVE_KEY = 'liveSources';

// 判断资源站是否属于成人向（名称或 URL 含关键字）
function isAdultSourceName(name, url) {
    const text = ((name || '') + ' ' + (url || '')).toLowerCase();
    const adultKeywords = [
        '黄色', '成人', '色情', 'av', '大奶', '老色逼', '黑料', '桃花',
        '番号', '乐播', '湿乐园', '杏吧', 'jkun', '越南', '滴滴', 'hsck', 'avs'
    ];
    return adultKeywords.some(function(k) {
        return text.includes(k);
    });
}

// 解析订阅 JSON 文本（容忍多种结构：直接数组 / {sources} / {data:{sources}}）
function parseSubscriptionText(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('JSON 解析失败: ' + e.message);
    }
    let sources = (data && data.sources) || (data && data.data && data.data.sources) || [];
    let liveSources = (data && data.liveSources) || (data && data.data && data.data.liveSources) || [];
    if (!Array.isArray(sources) && Array.isArray(data)) {
        sources = data; // 直接是数组
    }
    if (!Array.isArray(sources) && !Array.isArray(liveSources)) {
        // 可能是 API_SITES 风格 {key: {name,url/api}}
        const apis = (data && data.sourcesByKey) ? data.sourcesByKey
                    : ((data && data.apiSites) ? data.apiSites : null);
        if (apis && typeof apis === 'object') {
            sources = Object.keys(apis).map(function(k) {
                const v = apis[k];
                return { name: v.name || k, url: v.api || v.url || '' };
            });
            if (sources.length === 0) throw new Error('订阅中未找到有效数据源');
        } else {
            throw new Error('订阅格式不是 LibreTV-SourceList v2（缺少 sources/liveSources）');
        }
    }
    return { sources: sources || [], liveSources: liveSources || [], raw: data };
}

// 从订阅数据合并进 customAPIs，返回统计
function importSubscriptionData(sources, liveSources, opts) {
    opts = opts || {};
    const normalize = function(u) {
        u = (u || '').trim();
        if (u.endsWith('/')) u = u.slice(0, -1);
        return u;
    };

    // 已存在的 URL 集合（内置 + 自定义），避免重复
    const existingUrls = new Set();
    Object.keys(API_SITES).forEach(function(k) {
        const s = API_SITES[k];
        if (s.api) existingUrls.add(normalize(s.api));
        if (s.detail) existingUrls.add(normalize(s.detail));
    });
    (customAPIs || []).forEach(function(a) {
        if (a.url) existingUrls.add(normalize(a.url));
    });

    let addedCount = 0;
    const addedNames = [];
    (sources || []).forEach(function(s) {
        if (!s || !s.url) return;
        const name = (s.name || '').trim() || (s.url || '').split('/')[2] || '未知源';
        const url = normalize(s.url);
        if (!/^https?:\/\//.test(url)) return;
        if (existingUrls.has(url)) return; // 已存在，跳过

        const isAdult = isAdultSourceName(name, url);
        customAPIs.push({ name: name, url: url, detail: s.detail || url, isAdult: isAdult });
        existingUrls.add(url);
        addedCount++;
        addedNames.push(name);
    });

    // 直播源存起来（App 暂无直播页，先持久化）
    if (liveSources && liveSources.length > 0) {
        localStorage.setItem(SUBSCRIPTION_LIVE_KEY, JSON.stringify(liveSources));
    }

    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 自动勾选新增的自定义源（custom_N）
    if (addedCount > 0) {
        const newSelected = selectedAPIs.filter(function(id) {
            return !String(id).startsWith('custom_'); // 保留原有非custom选中
        });
        // 重新计算 custom 源数量后追加选中
        const totalCustom = customAPIs.length;
        for (let i = totalCustom - addedCount; i < totalCustom; i++) {
            newSelected.push('custom_' + i);
        }
        selectedAPIs = newSelected;
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
        if (typeof updateSelectedApiCount === 'function') updateSelectedApiCount();
    }

    return { addedCount: addedCount, addedNames: addedNames, liveCount: (liveSources || []).length };
}

// 从订阅链接导入（走 Tauri Rust 代理）
async function importSubscriptionFromUrl(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        if (typeof showToast === 'function') showToast('请输入订阅链接', 'warning');
        return null;
    }
    if (!/^https?:\/\//.test(trimmed)) {
        if (typeof showToast === 'function') showToast('链接需以 http:// 或 https:// 开头', 'warning');
        return null;
    }
    if (typeof showToast === 'function') showToast('正在拉取订阅...', 'info');

    // 使用统一的 executeApiRequest：Tauri 环境走 Rust 无 CORS 限制
    const response = await executeApiRequest(trimmed, { asText: true, timeoutSecs: 25, sourceForLog: 'subscription' });
    const text = typeof response === 'string' ? response : (response && response.body ? response.body : JSON.stringify(response));
    const parsed = parseSubscriptionText(text);
    const result = importSubscriptionData(parsed.sources, parsed.liveSources);
    return result;
}

// 从订阅 JSON 文本导入
function importSubscriptionFromText(text) {
    if (!text || !text.trim()) {
        if (typeof showToast === 'function') showToast('请粘贴订阅 JSON 内容', 'warning');
        return null;
    }
    const parsed = parseSubscriptionText(text);
    const result = importSubscriptionData(parsed.sources, parsed.liveSources);
    return result;
}

// 一键应用订阅链接（设置页按钮）
async function handleSubscriptionUrlImport() {
    try {
        const el = document.getElementById('subscriptionUrlInput');
        const url = el ? el.value : '';
        const result = await importSubscriptionFromUrl(url);
        finishSubscriptionImport(result, url);
    } catch (e) {
        if (typeof showToast === 'function') showToast('订阅导入失败: ' + (e.message || e), 'error');
        console.error('[Subscription] URL import failed:', e);
    }
}

// 一键应用订阅 JSON 文本（设置页按钮）
function handleSubscriptionTextImport() {
    try {
        const el = document.getElementById('subscriptionJsonInput');
        const text = el ? el.value : '';
        const result = importSubscriptionFromText(text);
        finishSubscriptionImport(result, '粘贴内容');
    } catch (e) {
        if (typeof showToast === 'function') showToast('订阅导入失败: ' + (e.message || e), 'error');
        console.error('[Subscription] Text import failed:', e);
    }
}

// 导入收尾：刷新列表 + toast
function finishSubscriptionImport(result, sourceDesc) {
    if (!result) return;
    if (typeof renderCustomAPIsList === 'function') renderCustomAPIsList();
    if (typeof initAPICheckboxes === 'function') initAPICheckboxes();

    if (result.addedCount === 0) {
        if (typeof showToast === 'function') {
            showToast('没有新增源（可能已在列表中），已导入直播源 ' + (result.liveCount || 0) + ' 个', 'info');
        }
        return;
    }

    const msg = '订阅导入成功：新增 ' + result.addedCount + ' 个点播源' +
        (result.liveCount > 0 ? '，' + result.liveCount + ' 个直播源' : '') +
        '，已自动启用';
    if (typeof showToast === 'function') showToast(msg, 'success');
    console.log('[Subscription] Imported from', sourceDesc, result);
    if (typeof window.updateSelectedAPIs === 'function') window.updateSelectedAPIs();
}