/**
 * 文章底部 1-5 星投票评分（后端 star-vote）
 * - 容器由 layouts/_partials/vote.html 输出，携带 data-post-vote-api / data-post-page-id
 * - 不硬编码服务地址，全部从容器 data 属性读取（由 hugo.yaml 的 solitude.post.vote.api 注入）
 * - 明暗/多端样式全部走 custom.css 的 --paper-* 变量，本文件只管行为
 * - 兼容 swup 无刷新切换：用 MutationObserver 扫描新增容器
 */
(function () {
  'use strict';

  var STORE_KEY = 'solitude-star-vote';

  function getStore() {
    try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function setStore(id, value) {
    var m = getStore();
    m[id] = value;
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch (e) {}
  }

  function init(root) {
    if (root.dataset.voteInit) return;
    root.dataset.voteInit = '1';

    var api = (root.dataset.postVoteApi || '').replace(/\/+$/, '');
    var pageId = root.dataset.postPageId || window.location.pathname;
    var stars = Array.prototype.slice.call(root.querySelectorAll('[data-vote-value]'));
    var scoreEl = root.querySelector('[data-vote-score]');
    var countEl = root.querySelector('[data-vote-count]');
    var meterEl = root.querySelector('[data-vote-meter]');
    if (!api || !stars.length) return;

    var myVote = getStore()[pageId] || 0;

    // 亮起 [1, v] 的星
    function paint(v) {
      stars.forEach(function (s) {
        s.classList.toggle('is-selected', Number(s.dataset.voteValue) <= v);
        s.setAttribute('aria-checked', Number(s.dataset.voteValue) <= v ? 'true' : 'false');
      });
    }

    // 渲染服务端返回的统计（{rating:{ "1":..,"5":.. }}）
    function renderStats(data) {
      var r = (data && data.rating) || {};
      var total = 0, sum = 0;
      for (var v = 1; v <= 5; v++) {
        var c = Number(r[v]) || 0;
        total += c;
        sum += c * v;
      }
      var avg = total ? sum / total : 0;
      if (scoreEl) scoreEl.textContent = total ? avg.toFixed(1) : '—';
      if (countEl) countEl.textContent = total ? total + ' 人已评' : '暂无评分';
      if (meterEl) meterEl.style.width = (total ? Math.round((avg / 5) * 100) : 0) + '%';
      paint(myVote);
      return total;
    }

    // 拉取当前统计并首绘
    fetch(api + '/api/rating/info?id=' + encodeURIComponent(pageId))
      .then(function (res) { return res.json(); })
      .catch(function () { return {}; })
      .then(renderStats);

    // 悬停/聚焦预览（未投票时才可预览）
    function preview(v) {
      if (myVote) return;
      stars.forEach(function (s) {
        s.classList.toggle('is-active', Number(s.dataset.voteValue) <= v);
      });
    }
    function clearPreview() {
      stars.forEach(function (s) { s.classList.remove('is-active'); });
    }

    function submit(v) {
      if (myVote) return;
      myVote = v;
      setStore(pageId, v);
      paint(v);
      fetch(api + '/api/rating/update?id=' + encodeURIComponent(pageId) + '&value=' + v, { method: 'POST' })
        .then(function (res) { return res.json(); })
        .then(function () {
          return fetch(api + '/api/rating/info?id=' + encodeURIComponent(pageId));
        })
        .then(function (res) { return res.json(); })
        .then(renderStats)
        .catch(function (err) { console.error('[star-vote]', err); });
    }

    stars.forEach(function (s) {
      var v = Number(s.dataset.voteValue);
      s.addEventListener('mouseenter', function () { preview(v); });
      s.addEventListener('mouseleave', clearPreview);
      s.addEventListener('focus', function () { preview(v); });
      s.addEventListener('blur', clearPreview);
      s.addEventListener('click', function () { submit(v); });
    });
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-post-vote]');
    for (var i = 0; i < nodes.length; i++) init(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  // swup 无刷新替换正文后，新容器被插入时即时初始化
  var mo = new MutationObserver(function () {
    if (!document.querySelector('[data-post-vote]:not([data-vote-init])')) return;
    scan();
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
