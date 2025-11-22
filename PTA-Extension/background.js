// 编译器映射表
const COMPILER_MAP = {
    "GCC": "1", "CLANG": "1",
    "GXX": "2", "CLANGXX": "2", "C++": "2",
    "JAVA": "3",
    "PYTHON3": "4", "PYPY3": "4"
};

// 结果映射表
const RESULT_MAP = {
    "ACCEPTED": "AC",
    "WRONG_ANSWER": "WA",
    "TIME_LIMIT_EXCEEDED": "TLE",
    "COMPILE_ERROR": "CE",
    "SEGMENTATION_FAULT": "SF",
    "FLOAT_POINT_EXCEPTION": "FPE",
    "MEMORY_LIMIT_EXCEEDED": "MLE",
    "NON_ZERO_EXIT_CODE": "NZEC",
    "RUNTIME_ERROR": "RE",
    "PRESENTATION_ERROR": "PE",
    "OUTPUT_LIMIT_EXCEEDED": "OLE"
};

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

// 发送请求
async function apiRequest(url, params = {}) {
    const cookies = await getCookies();
    const cookieString = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ');

    const queryString = new URLSearchParams(params).toString();
    const fullUrl = queryString ? `${url}?${queryString}` : url;

    const response = await fetch(fullUrl, {
        headers: {
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://pintia.cn/',
            'Accept': 'application/json, text/plain, */*'
        },
        credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
}

// 获取题目集列表
async function getProblemSets() {
    const allSets = [];
    let page = 0;
    const limit = 50;

    while (true) {
        const data = await apiRequest('https://pintia.cn/api/problem-sets/admin', {
            sort_by: '{"type":"UPDATE_AT","asc":false}',
            page: page,
            limit: limit,
            filter: '{"ownerId":"0"}'
        });

        const current = data.problemSets || [];
        if (current.length === 0) break;

        allSets.push(...current);
        if (current.length < limit) break;
        page++;
    }

    return allSets.map(ps => ({
        name: ps.name || "未命名题目集",
        id: ps.id,
        start_time: ps.startAt
    }));
}

// 生成 XML
async function generateXML(problemSetId, organization, regionId) {
    console.log('开始生成XML...');

    // 获取比赛信息
    const examInfo = await apiRequest(`https://pintia.cn/api/problem-sets/${problemSetId}`);
    const problemSet = examInfo.problemSet || {};

    // 解析时间
    const startAt = new Date(problemSet.startAt || '1970-01-01T00:00:00Z');
    const endAt = new Date(problemSet.endAt || '1970-01-01T00:00:00Z');
    const contestStartTimestamp = startAt.getTime() / 1000;

    // 计算时长
    let durationSec = problemSet.duration || 0;
    if (durationSec <= 0) {
        durationSec = Math.floor((endAt - startAt) / 1000);
    }
    if (durationSec <= 0) durationSec = 18000;

    const hours = Math.floor(durationSec / 3600);
    const minutes = Math.floor((durationSec % 3600) / 60);
    const seconds = durationSec % 60;
    const durationStr = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // 获取题目列表
    const problemData = await apiRequest(
        `https://pintia.cn/api/problem-sets/${problemSetId}/preview/problems`,
        { problem_type: 'PROGRAMMING', page: 0, limit: 500 }
    );

    const problems = problemData.problemSetProblems || [];
    const labelMap = {};

    problems.forEach((p, idx) => {
        labelMap[p.id] = {
            xml_id: String(idx + 1),
            letter: String.fromCharCode(65 + idx)
        };
    });

    // 获取队伍信息
    console.log('获取队伍信息...');
    const teams = await getTeams(problemSetId);

    // 获取提交记录
    console.log('获取提交记录...');
    const submissions = await getSubmissions(problemSetId);

    // 构建 XML
    const xml = buildXML({
        problemSet,
        contestStartTimestamp,
        durationStr,
        organization,
        regionId,
        problems,
        labelMap,
        teams,
        submissions
    });

    return xml;
}

// 获取队伍信息
async function getTeams(problemSetId) {
    const teams = [];
    let page = 0;
    const limit = 20;

    const examByUserId = {};
    const studentUserById = {};

    while (true) {
        const data = await apiRequest(
            `https://pintia.cn/api/problem-sets/${problemSetId}/user-group-members`,
            {
                exam_status: 'UNKNOWN',
                page: page,
                limit: limit,
                order_by: 'startAt',
                asc: 'false'
            }
        );

        Object.assign(examByUserId, data.examByUserId || {});
        Object.assign(studentUserById, data.studentUserById || {});

        const members = data.userGroupMembers || [];
        if (members.length === 0) break;

        members.forEach(member => {
            const userId = member.userId;
            const studentUserId = member.studentUserId;

            let name = '';
            if (examByUserId[userId]) {
                name = examByUserId[userId].studentUser?.name || '';
            }
            if (!name && studentUserById[studentUserId]) {
                name = studentUserById[studentUserId].name || '';
            }
            if (!name) {
                name = `Team_${userId}`;
            }

            teams.push({ userId, name });
        });

        if (members.length < limit) break;
        page++;
    }

    return teams;
}

// 获取提交记录
async function getSubmissions(problemSetId) {
    const submissions = [];
    let before = null;

    while (true) {
        const params = { limit: 100 };
        if (before) params.before = before;

        const data = await apiRequest(
            `https://pintia.cn/api/problem-sets/${problemSetId}/submissions`,
            params
        );

        const subs = data.submissions || [];
        if (subs.length === 0) break;

        submissions.push(...subs);

        const hasMore = data.hasBefore || false;
        if (!hasMore) break;

        const nextCursor = subs[subs.length - 1].id;
        if (nextCursor === before) break;

        before = nextCursor;

        // 防止请求过快
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    return submissions;
}

// 构建 XML
function buildXML(config) {
    const {
        problemSet,
        contestStartTimestamp,
        durationStr,
        organization,
        regionId,
        problems,
        labelMap,
        teams,
        submissions
    } = config;

    let xml = '<?xml version="1.0" encoding="utf-8"?>\n<contest>\n';

    // Info
    xml += '  <info>\n';
    xml += `    <title>${escapeXml(problemSet.name || 'PTA Contest')}</title>\n`;
    xml += `    <short-title>${escapeXml(problemSet.name || 'PTA Contest')}</short-title>\n`;
    xml += `    <contest-id>${problemSet.id || '0'}</contest-id>\n`;
    xml += `    <starttime>${contestStartTimestamp.toFixed(1)}</starttime>\n`;
    xml += `    <length>${durationStr}</length>\n`;
    xml += `    <penalty>20</penalty>\n`;
    xml += `    <started>False</started>\n`;
    xml += `    <scoreboard-freeze-length>1:00:00</scoreboard-freeze-length>\n`;
    xml += '  </info>\n';

    // Region
    xml += '  <region>\n';
    xml += `    <external-id>${regionId}</external-id>\n`;
    xml += `    <name>${organization}</name>\n`;
    xml += '  </region>\n';

    // Judgements
    const judgements = [
        ["1", "AC", "ACCEPTED", "true", "false"],
        ["2", "SF", "SEGMENTATION_FAULT", "false", "true"],
        ["3", "WA", "WRONG_ANSWER", "false", "true"],
        ["4", "TLE", "TIME_LIMIT_EXCEEDED", "false", "true"],
        ["5", "CE", "COMPILE_ERROR", "false", "false"],
        ["6", "FPE", "FLOAT_POINT_EXCEPTION", "false", "true"],
        ["7", "MLE", "MEMORY_LIMIT_EXCEEDED", "false", "true"],
        ["8", "NZEC", "NON_ZERO_EXIT_CODE", "false", "true"],
        ["9", "RE", "RUNTIME_ERROR", "false", "true"],
        ["10", "PE", "PRESENTATION_ERROR", "false", "true"],
        ["11", "OLE", "OUTPUT_LIMIT_EXCEEDED", "false", "true"]
    ];

    judgements.forEach(([id, acr, name, solved, penalty]) => {
        xml += '  <judgement>\n';
        xml += `    <id>${id}</id>\n`;
        xml += `    <acronym>${acr}</acronym>\n`;
        xml += `    <name>${name}</name>\n`;
        xml += `    <solved>${solved}</solved>\n`;
        xml += `    <penalty>${penalty}</penalty>\n`;
        xml += '  </judgement>\n';
    });

    // Languages
    const languages = [["1", "c"], ["2", "c++"], ["3", "java"], ["4", "python"]];
    languages.forEach(([id, name]) => {
        xml += '  <language>\n';
        xml += `    <id>${id}</id>\n`;
        xml += `    <name>${name}</name>\n`;
        xml += '  </language>\n';
    });

    // Problems
    problems.forEach((p, idx) => {
        const letter = String.fromCharCode(65 + idx);
        xml += '  <problem>\n';
        xml += `    <id>${idx + 1}</id>\n`;
        xml += `    <letter>${letter}</letter>\n`;
        xml += `    <name>Problem ${letter}</name>\n`;
        xml += '  </problem>\n';
    });

    // Teams
    teams.forEach(team => {
        xml += '  <team>\n';
        xml += `    <id>${team.userId}</id>\n`;
        xml += `    <external-id>${regionId}</external-id>\n`;
        xml += `    <region>${organization}</region>\n`;
        xml += `    <name>${escapeXml(team.name)}</name>\n`;
        xml += `    <university>${organization}</university>\n`;
        xml += '  </team>\n';
    });

    // Submissions
    let counter = 1;
    submissions.forEach(sub => {
        const problemId = sub.problemSetProblemId;
        if (!labelMap[problemId]) return;

        const problemConf = labelMap[problemId];
        const ptaStatus = sub.status || 'UNKNOWN';
        const solved = ptaStatus === 'ACCEPTED' ? 'true' : 'false';
        const penalty = ptaStatus === 'COMPILE_ERROR' ? 'false' : 'true';
        const resultAcronym = RESULT_MAP[ptaStatus] || 'WA';

        const compiler = (sub.compiler || 'UNKNOWN').toUpperCase();
        const langId = COMPILER_MAP[compiler] || '1';

        const submitAt = new Date(sub.submitAt);
        const submitTimestamp = submitAt.getTime() / 1000;
        const relTimeSec = Math.max(0, Math.floor(submitTimestamp - contestStartTimestamp));

        xml += '  <run>\n';
        xml += `    <id>${counter}</id>\n`;
        xml += `    <judged>True</judged>\n`;
        xml += `    <language>${langId}</language>\n`;
        xml += `    <problem>${problemConf.xml_id}</problem>\n`;
        xml += `    <status>done</status>\n`;
        xml += `    <team>${sub.userId}</team>\n`;
        xml += `    <time>${relTimeSec}</time>\n`;
        xml += `    <timestamp>${submitTimestamp.toFixed(2)}</timestamp>\n`;
        xml += `    <solved>${solved}</solved>\n`;
        xml += `    <penalty>${penalty}</penalty>\n`;
        xml += `    <result>${resultAcronym}</result>\n`;
        xml += '  </run>\n';

        counter++;
    });

    // Finalized
    xml += '  <finalized>\n';
    xml += `    <last_gold>1</last_gold>\n`;
    xml += `    <last_silver>1</last_silver>\n`;
    xml += `    <last_bronze>1</last_bronze>\n`;
    xml += `    <time>${durationStr}</time>\n`;
    xml += `    <timestamp>${Date.now() / 1000}</timestamp>\n`;
    xml += '  </finalized>\n';

    xml += '</contest>';

    return xml;
}

// XML 转义
function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        try {
            if (request.action === 'getProblemSets') {
                const data = await getProblemSets();
                sendResponse({ data });
            } else if (request.action === 'generateXML') {
                const xml = await generateXML(
                    request.problemSetId,
                    request.organization,
                    request.regionId
                );
                sendResponse({ data: xml });
            }
        } catch (error) {
            sendResponse({ error: error.message });
        }
    })();

    return true; // 保持消息通道开放
});