/** Deliberately standalone: no frontend build tools, CDN or framework. */
export const demoPage = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AnyFrame · HTTP / WS 测试</title>
<style>body{font:16px system-ui;max-width:720px;margin:32px auto;padding:0 16px;color:#20242b;background:#f6f7f9}section{background:white;border:1px solid #ddd;border-radius:12px;padding:18px;margin:16px 0}h1{font-size:24px}h2{font-size:19px}input,textarea,button{font:inherit;padding:10px;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}input,textarea{max-width:100%}textarea{width:100%;min-height:72px}button{cursor:pointer}form,.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}input{flex:1;min-width:100px}li{margin:12px 0;overflow-wrap:anywhere}li p{white-space:pre-wrap}small{color:#596373}#messages{max-height:240px;overflow:auto;padding-left:22px}#status{color:#596373}button:disabled{cursor:default;opacity:.5}</style>
<h1>AnyFrame 服务测试</h1><small>HTTP 记事本 · WebSocket 聊天室</small>
<section><h2>记事本 · HTTP CRUD</h2><form id="noteForm"><textarea id="note" placeholder="写一条笔记" maxlength="2000" required aria-label="笔记内容"></textarea><button id="save">新增</button><button id="cancel" type="button" hidden>取消编辑</button></form><ul id="notes"></ul></section>
<section><h2>聊天室 · WebSocket</h2><p id="status" role="status">连接中…</p><button id="reconnect" type="button" hidden>重新连接</button><ul id="messages" aria-live="polite"></ul><form id="chatForm"><input id="name" value="访客" maxlength="20" aria-label="昵称"><input id="message" placeholder="消息" maxlength="500" required aria-label="消息"><button id="send" disabled>发送</button></form><small>打开两个页面测试实时广播；聊天消息不保存。</small></section>
<p id="error" role="alert"></p>
<script>
const $=id=>document.getElementById(id);let editing=null,socket;
function report(e){$('error').textContent=e.message||String(e)}
async function api(path,method='GET',data){const r=await fetch('/api/notes'+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'请求失败');return result}
function reset() {editing=null;$('note').value='';$('save').textContent='新增';$('cancel').hidden=true}
async function load(){const notes=await api('');$('notes').replaceChildren();for(const n of notes){const li=document.createElement('li'),p=document.createElement('p'),edit=document.createElement('button'),del=document.createElement('button');p.textContent=n.text;edit.textContent='编辑';del.textContent='删除';edit.onclick=()=>{editing=n.id;$('note').value=n.text;$('save').textContent='保存修改';$('cancel').hidden=false};del.onclick=async()=>{try{await api('/'+n.id,'DELETE');if(editing===n.id)reset();await load()}catch(e){report(e)}};li.append(p,edit,' ',del);$('notes').append(li)}}
$('cancel').onclick=reset;
$('noteForm').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;try{await api(editing?'/'+editing:'',editing?'PUT':'POST',{text:$('note').value});reset();await load();$('error').textContent=''}catch(e){report(e)}finally{$('save').disabled=false}};
function connect(){socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');$('status').textContent='连接中…';$('reconnect').hidden=true;socket.onopen=()=>{$('status').textContent='已连接';$('send').disabled=false};socket.onclose=()=>{$('status').textContent='已断开';$('send').disabled=true;$('reconnect').hidden=false};socket.onerror=()=>{$('status').textContent='连接失败'};socket.onmessage=e=>{try{const m=JSON.parse(e.data),li=document.createElement('li');li.textContent=m.name+'：'+m.text;$('messages').append(li);while($('messages').children.length>100)$('messages').firstChild.remove();li.scrollIntoView({block:'nearest'})}catch(e){report(e)}}}
$('reconnect').onclick=connect;
$('chatForm').onsubmit=e=>{e.preventDefault();if(socket.readyState!==WebSocket.OPEN)return;const text=$('message').value.trim();if(!text)return;socket.send(JSON.stringify({name:$('name').value,text}));$('message').value=''};
load().catch(report);connect();
</script></html>`
