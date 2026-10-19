"""Collect public AI feeds and optionally deliver via PushPlus. No external dependencies."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import html
import json
import os
from pathlib import Path
import sys
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

FEEDS = {
    'OpenAI 新闻': 'https://openai.com/news/rss.xml',
    'Google AI': 'https://blog.google/technology/ai/rss/',
    'Hugging Face': 'https://huggingface.co/blog/feed.xml',
    'Codex 发布': 'https://github.com/openai/codex/releases.atom',
    'Claude Code 发布': 'https://github.com/anthropics/claude-code/releases.atom',
    'Ollama 发布': 'https://github.com/ollama/ollama/releases.atom',
}
ATOM = '{http://www.w3.org/2005/Atom}'

def parse_feed(data, source, now):
    root = ET.fromstring(data)
    entries = root.findall('.//item') + root.findall(ATOM + 'entry')
    result = []
    for entry in entries:
        title = entry.findtext('title') or entry.findtext(ATOM + 'title') or ''
        link = entry.findtext('link')
        if not link:
            link = next((e.get('href') for e in entry.findall(ATOM + 'link')
                         if e.get('rel', 'alternate') == 'alternate'), '')
        date = entry.findtext('pubDate') or entry.findtext(ATOM + 'published') or entry.findtext(ATOM + 'updated')
        if not date or not link or not link.startswith('https://'):
            continue
        try:
            try:
                published = datetime.fromisoformat(date.replace('Z', '+00:00'))
            except ValueError:
                published = parsedate_to_datetime(date)
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
        if now - timedelta(hours=24) <= published <= now:
            result.append((published, source, title.strip(), link))
    return result

def fetch_feed(pair):
    source, url = pair
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'AI-Daily/1.0'})
        with urllib.request.urlopen(req, timeout=25) as res:
            return source, res.read(), None
    except Exception:
        # Never log request objects or credential-bearing URLs.
        return source, None, '获取失败'

def render(items, failures, now):
    local = now.astimezone(timezone(timedelta(hours=8)))
    title = 'AI 日报 · ' + local.strftime('%Y-%m-%d')
    parts = ['<h2>' + title + '</h2>', '<p>过去24小时的官方新闻与开发工具动态；标题与链接版，未使用模型生成摘要。按发布时间排序，最多8条。</p>']
    if items:
        parts.append('<ol>')
        for date, source, text, link in items[:8]:
            parts.append('<li><a href="' + html.escape(link, quote=True) + '">' + html.escape(text) + '</a> — ' + html.escape(source) + '</li>')
        parts.append('</ol>')
    else:
        parts.append('<p>成功获取的来源中，过去24小时暂无新动态。</p>')
    if failures:
        parts.append('<p>本期来源不完整，获取失败：' + html.escape('、'.join(failures)) + '。</p>')
    return title, '\n'.join(parts)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--send', action='store_true')
    parser.add_argument('--output', default='daily.html')
    args = parser.parse_args()
    token = os.environ.get('PUSHPLUS_TOKEN', '').strip()
    if args.send and not token:
        raise SystemExit('缺少 PUSHPLUS_TOKEN；请在 GitHub Actions Secrets 中配置。')
    now = datetime.now(timezone.utc)
    items, failures, succeeded = [], [], 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for source, data, error in pool.map(fetch_feed, FEEDS.items()):
            if error:
                failures.append(source)
                continue
            try:
                items.extend(parse_feed(data, source, now))
                succeeded += 1
            except ET.ParseError:
                failures.append(source)
    if not succeeded:
        raise SystemExit('所有新闻源均不可用，停止发送，避免发送误导性的空日报。')
    unique = {item[3]: item for item in sorted(items)}
    items = sorted(unique.values(), reverse=True)
    title, content = render(items, failures, now)
    Path(args.output).write_text(content, encoding='utf-8')
    print(f'成功来源 {succeeded}/{len(FEEDS)}，过去24小时动态 {len(items)} 条，输出 {args.output}')
    if args.send:
        payload = json.dumps({'token': token, 'title': title, 'content': content, 'template': 'html'}).encode()
        req = urllib.request.Request('https://www.pushplus.plus/send', data=payload, headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                status = json.load(res)
        except Exception:
            raise SystemExit('推送请求失败；请检查服务状态和网络。为避免重复消息，本次不自动重试。') from None
        if status.get('code') != 200:
            raise SystemExit('推送服务未接受请求；请检查 Token、账号绑定、服务额度。')
        print('PushPlus 已接受请求；实际微信送达请在接收端确认。')

if __name__ == '__main__':
    main()
