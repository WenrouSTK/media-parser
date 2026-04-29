// 小红书 adapter：拉 HTML → 抠 __INITIAL_STATE__ → 拿原图/视频
// 常见 URL：
//   https://www.xiaohongshu.com/explore/<noteId>?xsec_token=xxx
//   https://www.xiaohongshu.com/discovery/item/<noteId>
//   http://xhslink.com/xxx  (短链，需要 302 跟)
import { fetch } from 'undici';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const COMMON_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Cache-Control': 'no-cache',
};

// 跟随短链，返回最终落地 URL
async function resolveShortLink(url) {
  if (!/xhslink\.com/i.test(url)) return url;
  const resp = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: COMMON_HEADERS,
  });
  return resp.url;
}

// 从 URL 抽 noteId
function extractNoteId(url) {
  const m = url.match(/\/(?:explore|discovery\/item|item)\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

// 拉 HTML
async function fetchHtml(url) {
  const resp = await fetch(url, { headers: COMMON_HEADERS });
  if (!resp.ok) throw new Error(`小红书返回 ${resp.status}`);
  return await resp.text();
}

// 从 HTML 抠 __INITIAL_STATE__
function extractInitialState(html) {
  // 小红书现行模式：window.__INITIAL_STATE__=JSON
  let m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\})\s*<\/script>/);
  if (!m) m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]+?\});/);
  if (!m) return null;
  let raw = m[1];
  // 小红书会把 undefined 塞进 JSON（非法），替换一下
  raw = raw.replace(/:undefined/g, ':null').replace(/undefined/g, 'null');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 有时候 JSON 末尾截断，退一步做兜底
    return null;
  }
}

// 把 H265 的 sns-webpic 图片改成 jpg 原图
function pickOriginalImage(img) {
  // 常见字段：urlDefault / urlPre / urlSizeLarge / infoList[]
  // infoList: [{imageScene:'WB_DFT', url:...}, {imageScene:'WB_PRV', url:...}]
  if (img.infoList && img.infoList.length) {
    // WB_DFT 默认是原图
    const dft = img.infoList.find(i => i.imageScene === 'WB_DFT');
    if (dft) return dft.url;
    return img.infoList[0].url;
  }
  let url = img.urlDefault || img.urlSizeLarge || img.urlPre || img.url;
  if (!url) return null;
  // 移除 webp 水印参数，强制原图：xhscdn.com 的 !nd_dft_wgth_webp_3 改掉
  url = url.replace(/!nd_\w+_webp_\d+/g, '');
  url = url.replace(/\.webp/i, '.jpg');
  return url;
}

function buildVideoUrl(stream) {
  // stream.h264[0].masterUrl 或 stream.h265[0].masterUrl
  if (!stream) return null;
  const codecs = ['h264', 'h265', 'av1'];
  for (const c of codecs) {
    if (stream[c] && stream[c].length) {
      const v = stream[c][0];
      if (v.masterUrl) return v.masterUrl;
      if (v.backupUrls && v.backupUrls.length) return v.backupUrls[0];
    }
  }
  return null;
}

// 从解析出的 state 拿 note 数据
function pickNote(state, noteId) {
  const noteMap = state?.note?.noteDetailMap;
  if (!noteMap) return null;
  if (noteId && noteMap[noteId]?.note) return noteMap[noteId].note;
  // 兜底：拿 map 里第一个
  const firstKey = Object.keys(noteMap)[0];
  return firstKey ? noteMap[firstKey]?.note : null;
}

export async function parse(url) {
  const finalUrl = await resolveShortLink(url);
  const noteId = extractNoteId(finalUrl);

  const html = await fetchHtml(finalUrl);
  const state = extractInitialState(html);
  if (!state) {
    throw new Error('解析失败：未找到 __INITIAL_STATE__（小红书可能改版，或此笔记需登录）');
  }

  const note = pickNote(state, noteId);
  if (!note) {
    throw new Error('解析失败：未找到笔记内容');
  }

  const title = note.title || note.desc?.slice(0, 40) || '小红书笔记';
  const author = note.user?.nickname ? '@' + note.user.nickname : '';
  const avatar = note.user?.avatar || '';

  const items = [];

  // 图片
  if (note.imageList && note.imageList.length) {
    note.imageList.forEach((img, idx) => {
      const u = pickOriginalImage(img);
      if (u) {
        items.push({
          type: 'image',
          url: u,
          filename: `xhs_${noteId || Date.now()}_${idx + 1}.jpg`,
        });
      }
    });
  }

  // 视频
  if (note.video) {
    const vUrl = buildVideoUrl(note.video?.media?.stream);
    if (vUrl) {
      items.push({
        type: 'video',
        url: vUrl,
        cover: note.imageList?.[0] ? pickOriginalImage(note.imageList[0]) : null,
        filename: `xhs_${noteId || Date.now()}.mp4`,
      });
    }
  }

  if (!items.length) {
    throw new Error('解析成功但未提取到媒体（可能是纯文字笔记）');
  }

  return {
    platform: { name: '小红书', icon: '📕', color: '#ff2741' },
    title,
    author,
    avatar: avatar ? '👤' : '📕',
    sourceUrl: finalUrl,
    items,
  };
}
