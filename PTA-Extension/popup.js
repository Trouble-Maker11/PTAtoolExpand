let selectedProblemSetId = null;
let problemSets = [];

// DOM 元素
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');
const generateBtn = document.getElementById('generateBtn');
const problemListEl = document.getElementById('problemList');
const openPintiaBtn = document.getElementById('openPintiaBtn');
const organizationInput = document.getElementById('organization');
const regionIdInput = document.getElementById('regionId');
const searchContainer = document.getElementById('searchContainer');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearch');
const searchResultCount = document.getElementById('searchResultCount');

// 更新状态
function updateStatus(message, type = 'info') {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
}

// 显示加载中
function setLoading(btn, loading) {
    if (loading) {
        btn.disabled = true;
        const loadingSpan = document.createElement('span');
        loadingSpan.className = 'loading';
        btn.insertBefore(loadingSpan, btn.firstChild);
    } else {
        btn.disabled = false;
        const loadingSpan = btn.querySelector('.loading');
        if (loadingSpan) loadingSpan.remove();
    }
}

// 获取 Cookies
async function getCookies() {
    const cookieNames = ['_bl_uid', '_ga', '_ga_ZHCNP8KECW', 'JSESSIONID', 'PTASession'];
    const cookies = {};

    for (const name of cookieNames) {
        const cookie = await chrome.cookies.get({
            url: 'https://pintia.cn',
            name: name
        });
        if (cookie) {
            cookies[name] = cookie.value;
        }
    }

    return cookies;
}

// 检查 Cookie 是否有效
async function checkCookies() {
    const cookies = await getCookies();
    if (!cookies.PTASession || !cookies.JSESSIONID) {
        updateStatus('未检测到登录信息,请先登录PTA', 'warning');
        return false;
    }
    return true;
}

// 搜索过滤函数
function filterProblemSets(searchTerm) {
    const items = problemListEl.querySelectorAll('.problem-item');
    let visibleCount = 0;

    items.forEach(item => {
        const name = item.querySelector('.problem-name').textContent;
        const id = item.dataset.id;
        const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            id.includes(searchTerm);

        if (matchesSearch) {
            item.classList.remove('hidden');
            visibleCount++;
        } else {
            item.classList.add('hidden');
        }
    });

    // 更新搜索结果计数
    if (searchTerm) {
        searchResultCount.textContent = `找到 ${visibleCount} 个匹配结果`;
        searchResultCount.style.display = 'block';
        clearSearchBtn.style.display = 'block';
    } else {
        searchResultCount.style.display = 'none';
        clearSearchBtn.style.display = 'none';
    }

    // 如果没有匹配结果,显示提示
    if (visibleCount === 0 && searchTerm) {
        if (!problemListEl.querySelector('.no-results')) {
            const noResults = document.createElement('div');
            noResults.className = 'empty-state no-results';
            noResults.textContent = '未找到匹配的题目集';
            problemListEl.appendChild(noResults);
        }
    } else {
        const noResults = problemListEl.querySelector('.no-results');
        if (noResults) noResults.remove();
    }
}

// 搜索输入事件
searchInput.addEventListener('input', (e) => {
    filterProblemSets(e.target.value.trim());
});

// 清除搜索
clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    filterProblemSets('');
    searchInput.focus();
});

// 刷新题目集列表
refreshBtn.addEventListener('click', async () => {
    if (!await checkCookies()) {
        return;
    }

    setLoading(refreshBtn, true);
    updateStatus('正在获取题目集列表...', 'info');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getProblemSets'
        });

        if (response.error) {
            throw new Error(response.error);
        }

        problemSets = response.data;
        displayProblemSets(problemSets);
        updateStatus(`成功加载 ${problemSets.length} 个题目集`, 'success');
        problemListEl.style.display = 'block';
        generateBtn.style.display = 'block';

        // 显示搜索框
        if (problemSets.length > 0) {
            searchContainer.style.display = 'block';
            searchInput.value = '';
            searchResultCount.style.display = 'none';
        }
    } catch (error) {
        updateStatus('获取题目集失败: ' + error.message, 'error');
        console.error(error);
    } finally {
        setLoading(refreshBtn, false);
    }
});

// 显示题目集列表
function displayProblemSets(sets) {
    if (sets.length === 0) {
        problemListEl.innerHTML = '<div class="empty-state">暂无题目集</div>';
        searchContainer.style.display = 'none';
        return;
    }

    problemListEl.innerHTML = sets.map(ps => `
        <div class="problem-item" data-id="${ps.id}">
            <div class="problem-name">${ps.name}</div>
            <div class="problem-meta">
                ID: ${ps.id} | 开始时间: ${ps.start_time || '未设置'}
            </div>
        </div>
    `).join('');

    // 绑定点击事件
    problemListEl.querySelectorAll('.problem-item').forEach(item => {
        item.addEventListener('click', () => {
            problemListEl.querySelectorAll('.problem-item').forEach(i =>
                i.classList.remove('selected'));
            item.classList.add('selected');
            selectedProblemSetId = item.dataset.id;
            generateBtn.disabled = false;
        });
    });
}

// 生成 XML
generateBtn.addEventListener('click', async () => {
    if (!selectedProblemSetId) {
        updateStatus('请先选择一个题目集', 'warning');
        return;
    }

    setLoading(generateBtn, true);
    updateStatus('正在生成XML文件,这可能需要几分钟...', 'info');

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'generateXML',
            problemSetId: selectedProblemSetId,
            organization: organizationInput.value || 'HBUE',
            regionId: regionIdInput.value || '1'
        });

        if (response.error) {
            throw new Error(response.error);
        }

        updateStatus('XML文件生成成功!正在下载...', 'success');

        // 触发下载
        const blob = new Blob([response.data], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
            url: url,
            filename: `contest_${selectedProblemSetId}.xml`,
            saveAs: true
        });

    } catch (error) {
        updateStatus('生成失败: ' + error.message, 'error');
        console.error(error);
    } finally {
        setLoading(generateBtn, false);
    }
});

// 打开 PTA 网站
openPintiaBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://pintia.cn' });
});

// 初始化
(async () => {
    if (await checkCookies()) {
        updateStatus('已检测到登录信息,点击刷新获取题目集', 'success');
    }
})();
