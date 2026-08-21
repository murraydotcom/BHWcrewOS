(function(){
'use strict';
var DB_NAME='bhw_capture_local_v1', STORE='entries', PIN_KEY='bhw_capture_pin_v1';
var db=null,currentMode='Brain Dump',recorder=null,stream=null,chunks=[],audioBlob=null,startedAt=0,recordedDurationMs=0,timerId=null,recognition=null,speechBase='',currentDetail=null,deferredInstall=null,hiddenAt=0,filterProject='All',transcriptionBusy=false,recordingTextBase='',transcriptionRun=0,titlePinned=false,projectPinned=false;
var MAX_TRANSCRIPTION_BYTES=4*1024*1024;
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function fmtDate(v){return new Date(v).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}
function fmtTime(ms){var s=Math.floor(ms/1000),m=Math.floor(s/60);return String(m).padStart(2,'0')+':'+String(s%60).padStart(2,'0')}
async function hashPin(pin){var b=new TextEncoder().encode('BHW-CAPTURE|'+pin),h=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(function(x){return x.toString(16).padStart(2,'0')}).join('')}
function openGate(){var saved=localStorage.getItem(PIN_KEY);$('gateCopy').textContent=saved?'Enter your local BHW Capture PIN.':'Set a local 6-digit PIN. This protects the notes stored on this phone; it is not a substitute for device security.';$('pinBtn').textContent=saved?'Open':'Set PIN & open';$('pinInput').value='';$('gateError').textContent='';$('gate').classList.remove('hidden');$('shell').setAttribute('aria-hidden','true');setTimeout(function(){$('pinInput').focus()},80)}
function unlock(){$('gate').classList.add('hidden');$('shell').setAttribute('aria-hidden','false');sessionStorage.setItem('bhw_capture_unlocked','1')}
async function handlePin(){var p=$('pinInput').value.replace(/\D/g,'');if(p.length!==6){$('gateError').textContent='Use exactly 6 digits.';return}var h=await hashPin(p),saved=localStorage.getItem(PIN_KEY);if(!saved){localStorage.setItem(PIN_KEY,h);unlock();return}if(h!==saved){$('gateError').textContent='That PIN does not match.';return}unlock()}
function openDB(){return new Promise(function(resolve,reject){var r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=function(){var d=r.result;if(!d.objectStoreNames.contains(STORE)){var s=d.createObjectStore(STORE,{keyPath:'id'});s.createIndex('createdAt','createdAt');s.createIndex('project','project');s.createIndex('mode','mode')}};r.onsuccess=function(){db=r.result;resolve(db)};r.onerror=function(){reject(r.error)}})}
function putEntry(e){return new Promise(function(resolve,reject){var r=db.transaction(STORE,'readwrite').objectStore(STORE).put(e);r.onsuccess=function(){resolve(e)};r.onerror=function(){reject(r.error)}})}
function allEntries(){return new Promise(function(resolve,reject){var r=db.transaction(STORE,'readonly').objectStore(STORE).getAll();r.onsuccess=function(){resolve((r.result||[]).sort(function(a,b){return b.createdAt-a.createdAt}))};r.onerror=function(){reject(r.error)}})}
function getEntry(id){return new Promise(function(resolve,reject){var r=db.transaction(STORE,'readonly').objectStore(STORE).get(id);r.onsuccess=function(){resolve(r.result)};r.onerror=function(){reject(r.error)}})}
function deleteEntry(id){return new Promise(function(resolve,reject){var r=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);r.onsuccess=function(){resolve()};r.onerror=function(){reject(r.error)}})}
function clearEntries(){return new Promise(function(resolve,reject){var r=db.transaction(STORE,'readwrite').objectStore(STORE).clear();r.onsuccess=function(){resolve()};r.onerror=function(){reject(r.error)}})}
function sentenceParts(text){return text.replace(/\s+/g,' ').trim().split(/[.!?]+\s*/).filter(Boolean)}
function inferProject(text){var t=text.toLowerCase(),rules=[['PREVENT-ND',['prevent-nd','prevent nd','neurodevelopment','before psychiatry']],['PSCM',['pscm','physiologic systems','compensation activation','amplification network','energy reserve']],['CharmEd Minds',['charmed','learning disability','working memory','processing speed','executive function']],['Mind & Mood',['mind and mood','mental health','cocm','bhi','psychiatry']],['Flow',['vascular','blood flow','abi','tbi','pwv','endothelial']],['EduMedia',['health irl','beyond normal','edumedia','video idea']],['BHW Operations',['crewos','workflow','staff','billing','front desk','refill','check-in','operations']]];for(var i=0;i<rules.length;i++){if(rules[i][1].some(function(k){return t.indexOf(k)>=0}))return rules[i][0]}return currentMode==='Research'?'Research':currentMode==='Operations'?'BHW Operations':'Personal work'}
function inferTags(text){var t=text.toLowerCase(),map=[['immune',['iga','igg','immune','autoimmune','cytokine']],['hormones',['estrogen','progesterone','thyroid','cortisol','hormone']],['nutrition',['zinc','magnesium','vitamin','omega','nutrition','micronutrient']],['neurodevelopment',['neurodevelopment','adhd','autism','learning','executive','processing','working memory']],['vascular',['vascular','endothelial','blood flow','arterial','abi','pwv']],['operations',['workflow','staff','task','process','billing','denial']],['research',['study','research','hypothesis','literature','pilot']],['education',['teach','training','curriculum','manual']],['content',['video','post','content','episode']]],out=[];map.forEach(function(r){if(r[1].some(function(k){return t.indexOf(k)>=0}))out.push(r[0])});return out.slice(0,6)}
function inferActions(text){var s=sentenceParts(text),re=/\b(need to|should|remember to|look up|research|follow up|follow-up|create|build|add|check|compare|find|send|write|develop|test|review)\b/i;return Array.from(new Set(s.filter(function(x){return re.test(x)}).map(function(x){return x.replace(/^[\-•\s]+/,'').trim()}))).slice(0,6)}
function buildTitle(text){var clean=text.replace(/\s+/g,' ').trim();if(!clean)return'Untitled capture';var first=clean.split(/[.!?\n]/)[0].trim();return first.length>74?first.slice(0,71)+'…':first}
function summarize(text){var clean=text.replace(/\s+/g,' ').trim();if(!clean)return'';var parts=sentenceParts(clean),picked=parts.slice(0,2).join('. ');if(picked&&/[A-Za-z0-9]$/.test(picked))picked+='.';return picked.length>320?picked.slice(0,317)+'…':picked}
function organize(){
var text=$('transcript').value.trim(),projectChoice=$('project').value;
var project=(!projectPinned||projectChoice==='Auto')?inferProject(text):projectChoice;
var title=titlePinned&&$('title').value.trim()?$('title').value.trim():buildTitle(text);
return{title:title,project:project,tags:inferTags(text),actions:inferActions(text),summary:summarize(text)}
}
function renderPreview(){
var text=$('transcript').value.trim(),box=$('organized');
try{
if(!text){box.innerHTML='<h3>Add a transcript first</h3><div class="kv"><b>Status</b><span>Record, type, or paste a non-PHI thought, then preview again.</span></div>';box.classList.remove('hidden');return null}
var o=organize();
if(!titlePinned)$('title').value=o.title;
if(!projectPinned&&Array.from($('project').options).some(function(x){return x.value===o.project}))$('project').value=o.project;
box.innerHTML='<h3>'+esc(o.title)+'</h3><div class="kv"><b>Project</b><span>'+esc(o.project)+'</span><b>Summary</b><span>'+esc(o.summary||'Add more detail to generate a useful summary.')+'</span><b>Tags</b><span>'+esc(o.tags.join(', ')||'—')+'</span><b>Actions</b><span>'+(o.actions.length?'<ul class="actions">'+o.actions.map(function(a){return'<li>'+esc(a)+'</li>'}).join('')+'</ul>':'—')+'</span></div>';
box.classList.remove('hidden');
return o
}catch(err){box.innerHTML='<h3>Could not organize this capture</h3><div class="kv"><b>Status</b><span>'+esc(err&&err.message?err.message:'Please try again.')+'</span></div>';box.classList.remove('hidden');return null}
}
function setCaptureBusy(busy){
transcriptionBusy=busy;
$('micBtn').disabled=busy;
$('organizeBtn').disabled=busy;
$('saveBtn').disabled=busy;
}
function cleanAudioType(type){return String(type||'audio/webm').split(';')[0].trim().toLowerCase()||'audio/webm'}
function combineTranscript(base,spoken){base=String(base||'').trim();spoken=String(spoken||'').trim();return base&&spoken?base+'\n\n'+spoken:(base||spoken)}
async function transcribeRecording(blob,runId){
if(!blob||!blob.size){$('recordStatus').textContent='The recording was empty. Try again or type your thought.';return}
if(blob.size>MAX_TRANSCRIPTION_BYTES){$('recordStatus').textContent='Recording ready, but it is too large for automatic transcription. Shorten it or type a transcript.';if($('transcript').value.trim())renderPreview();return}
setCaptureBusy(true);
$('recordLabel').textContent='Transcribing…';
$('recordStatus').textContent='Sending this non-PHI recording for server transcription…';
try{
var response=await fetch('/.netlify/functions/bhw-capture-transcribe',{method:'POST',headers:{'Content-Type':cleanAudioType(blob.type),'X-BHW-Capture-Non-PHI':'true'},body:blob});
var data={};try{data=await response.json()}catch(parseErr){}
if(!response.ok)throw new Error(data.error||('Transcription service returned '+response.status));
if(runId!==transcriptionRun)return;
var spoken=String(data.transcript||'').trim();
if(!spoken)throw new Error('No speech was detected');
$('transcript').value=combineTranscript(recordingTextBase,spoken);
var organized=renderPreview();
$('recordStatus').textContent='Transcript ready'+(organized?' · organization generated':'')+'. Review it before saving.';
}catch(err){
if(runId!==transcriptionRun)return;
if($('transcript').value.trim())renderPreview();
var message=String(err&&err.message?err.message:'service unavailable').replace(/\s+/g,' ').slice(0,160);
$('recordStatus').textContent='Recording ready. Automatic transcription was unavailable ('+message+'). Live text or typing still works.';
}finally{
if(runId===transcriptionRun){setCaptureBusy(false);$('recordLabel').textContent='Tap to capture'}
}
}
function speechCtor(){return window.SpeechRecognition||window.webkitSpeechRecognition||null}
function startSpeech(){var C=speechCtor();if(!C||!$('liveSpeech').checked){if($('liveSpeech').checked&&!C)$('recordStatus').textContent='Live speech-to-text is not available in this browser; audio will still record locally.';return}try{recognition=new C();recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';speechBase=$('transcript').value.trim();recognition.onresult=function(e){var finalText='',interim='';for(var i=e.resultIndex;i<e.results.length;i++){var tx=e.results[i][0].transcript;if(e.results[i].isFinal)finalText+=tx+' ';else interim+=tx}if(finalText)speechBase=(speechBase+' '+finalText).trim();$('transcript').value=(speechBase+(interim?' '+interim:'')).trim()};recognition.onerror=function(e){if(e.error!=='no-speech')$('recordStatus').textContent='Speech-to-text stopped ('+e.error+'). Audio recording continues locally.'};recognition.onend=function(){if(recorder&&recorder.state==='recording'){try{recognition.start()}catch(e){}}};recognition.start()}catch(e){recognition=null;$('recordStatus').textContent='Could not start live speech-to-text. Audio recording continues locally.'}}
function stopSpeech(){if(recognition){try{recognition.onend=null;recognition.stop()}catch(e){}recognition=null}}
async function startRecording(){
if(transcriptionBusy)return;
if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){$('recordStatus').textContent='This browser cannot record audio here. You can still type or paste a thought.';return}
try{
stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
chunks=[];audioBlob=null;recordedDurationMs=0;recordingTextBase=$('transcript').value.trim();var runId=++transcriptionRun;
var opts={};if(MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))opts.mimeType='audio/webm;codecs=opus';
var r=new MediaRecorder(stream,opts);recorder=r;
r.ondataavailable=function(e){if(e.data&&e.data.size)chunks.push(e.data)};
r.onstop=function(){
audioBlob=new Blob(chunks,{type:r.mimeType||'audio/webm'});
if(stream)stream.getTracks().forEach(function(t){t.stop()});stream=null;if(recorder===r)recorder=null;
transcribeRecording(audioBlob,runId)
};
r.start(1000);startedAt=Date.now();timerId=setInterval(function(){$('timer').textContent=fmtTime(Date.now()-startedAt)},250);
$('micBtn').classList.add('recording');$('recordLabel').textContent='Recording · tap to stop';$('recordStatus').textContent='Listening… non-PHI only.';startSpeech()
}catch(e){$('recordStatus').textContent='Microphone permission was not available: '+e.message}
}
function stopRecording(){
if(!recorder||recorder.state==='inactive')return;
recordedDurationMs=Math.max(0,Date.now()-startedAt);stopSpeech();recorder.stop();
if(timerId)clearInterval(timerId);timerId=null;$('micBtn').classList.remove('recording');
$('recordLabel').textContent='Finishing recording…';$('recordStatus').textContent='Preparing automatic non-PHI transcription…'
}
function resetCapture(){
if(recorder&&recorder.state==='recording')stopRecording();transcriptionRun++;setCaptureBusy(false);
$('transcript').value='';$('title').value='';$('project').value='Auto';$('organized').classList.add('hidden');$('timer').textContent='00:00';
$('recordStatus').textContent='Audio stays local when saved; non-PHI audio is sent for transcription after stop.';
audioBlob=null;chunks=[];startedAt=0;recordedDurationMs=0;recordingTextBase='';titlePinned=false;projectPinned=false;currentMode='Brain Dump';
document.querySelectorAll('[data-mode]').forEach(function(x){x.classList.toggle('active',x.dataset.mode==='Brain Dump')})
}
async function saveCapture(){
if(transcriptionBusy){alert('Wait for transcription to finish before saving.');return}
var text=$('transcript').value.trim();if(!text&&!audioBlob){alert('Capture a thought or record audio first.');return}
if(recorder&&recorder.state==='recording'){alert('Stop the recording before saving.');return}
var o=organize(),e={id:uid(),createdAt:Date.now(),mode:currentMode,title:o.title,project:o.project,tags:o.tags,actions:o.actions,summary:o.summary,transcript:text,audio:audioBlob||null,audioType:audioBlob?audioBlob.type:null,durationMs:recordedDurationMs,version:2};
try{await putEntry(e);resetCapture();document.querySelector('[data-tab="library"]').click()}catch(err){alert('Could not save locally: '+err.message)}
}
async function renderFilters(entries){var pro=['All'].concat(Array.from(new Set(entries.map(function(e){return e.project}).filter(Boolean))).sort());$('filters').innerHTML=pro.map(function(p){return'<button class="chip'+(p===filterProject?' active':'')+'" data-filter="'+esc(p)+'">'+esc(p)+'</button>'}).join('');Array.from($('filters').querySelectorAll('[data-filter]')).forEach(function(b){b.onclick=function(){filterProject=b.dataset.filter;renderLibrary()}})}
async function renderLibrary(){var entries=await allEntries(),q=$('search').value.trim().toLowerCase();await renderFilters(entries);var shown=entries.filter(function(e){if(filterProject!=='All'&&e.project!==filterProject)return false;if(!q)return true;return [e.title,e.project,e.mode,e.summary,e.transcript,(e.tags||[]).join(' '),(e.actions||[]).join(' ')].join(' ').toLowerCase().indexOf(q)>=0});if(!shown.length){$('memoryList').innerHTML='<div class="empty">'+(entries.length?'No matching memories.':'No captures yet. Your first brain dump will appear here.')+'</div>';return}$('memoryList').innerHTML=shown.map(function(e){return'<button class="memory" data-id="'+e.id+'"><div class="memory-top"><h3>'+esc(e.title)+'</h3><span class="date">'+esc(fmtDate(e.createdAt))+'</span></div><div class="badges"><span class="badge project">'+esc(e.project)+'</span><span class="badge">'+esc(e.mode)+'</span>'+(e.audio?'<span class="badge">audio</span>':'')+(e.tags||[]).slice(0,3).map(function(t){return'<span class="badge">'+esc(t)+'</span>'}).join('')+'</div><p>'+esc(e.summary||e.transcript||'Audio capture')+'</p></button>'}).join('');Array.from($('memoryList').querySelectorAll('[data-id]')).forEach(function(b){b.onclick=function(){openDetail(b.dataset.id)}})}
async function openDetail(id){var e=await getEntry(id);if(!e)return;currentDetail=e;$('detailMeta').textContent=fmtDate(e.createdAt)+' · '+e.mode;$('detailTitle').textContent=e.title;$('detailBadges').innerHTML='<span class="badge project">'+esc(e.project)+'</span>'+(e.tags||[]).map(function(t){return'<span class="badge">'+esc(t)+'</span>'}).join('');$('detailSummary').innerHTML='<div class="kv"><b>Summary</b><span>'+esc(e.summary||'—')+'</span><b>Actions</b><span>'+(e.actions&&e.actions.length?'<ul class="actions">'+e.actions.map(function(a){return'<li>'+esc(a)+'</li>'}).join('')+'</ul>':'—')+'</span></div>';$('detailText').textContent=e.transcript||'No text transcript was saved.';var au=$('detailAudio');if(e.audio){au.src=URL.createObjectURL(e.audio);au.classList.remove('hidden')}else{au.removeAttribute('src');au.classList.add('hidden')}$('detailSheet').classList.remove('hidden')}
function closeDetail(){var au=$('detailAudio');if(au.src&&au.src.indexOf('blob:')===0)URL.revokeObjectURL(au.src);au.removeAttribute('src');$('detailSheet').classList.add('hidden');currentDetail=null}
async function exportMemory(){var entries=await allEntries(),clean=entries.map(function(e){return{id:e.id,createdAt:new Date(e.createdAt).toISOString(),mode:e.mode,title:e.title,project:e.project,tags:e.tags,actions:e.actions,summary:e.summary,transcript:e.transcript,hasAudio:!!e.audio,durationMs:e.durationMs||0}}),blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),product:'BHW Capture MVP',entries:clean},null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='bhw-capture-memory-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u)},1000)}
function bind(){
$('pinInput').addEventListener('input',function(){this.value=this.value.replace(/\D/g,'').slice(0,6)});$('pinInput').addEventListener('keydown',function(e){if(e.key==='Enter')handlePin()});$('pinBtn').onclick=handlePin;$('lockBtn').onclick=function(){sessionStorage.removeItem('bhw_capture_unlocked');openGate()};
document.addEventListener('visibilitychange',function(){if(document.hidden)hiddenAt=Date.now();else if(hiddenAt&&Date.now()-hiddenAt>5*60*1000){sessionStorage.removeItem('bhw_capture_unlocked');openGate()}});
document.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){if(b.disabled)return;currentMode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(function(x){x.classList.toggle('active',x===b)});$('organized').classList.add('hidden')}});
document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('active',x===b)});var cap=b.dataset.tab==='capture';$('captureView').classList.toggle('hidden',!cap);$('libraryView').classList.toggle('hidden',cap);if(!cap)renderLibrary()}});
$('organizeBtn').onclick=function(){renderPreview()};$('micBtn').onclick=function(){if(recorder&&recorder.state==='recording')stopRecording();else startRecording()};$('saveBtn').onclick=saveCapture;
$('transcript').addEventListener('input',function(){$('organized').classList.add('hidden')});
$('title').addEventListener('input',function(){titlePinned=!!this.value.trim();$('organized').classList.add('hidden')});
$('project').addEventListener('change',function(){projectPinned=this.value!=='Auto';$('organized').classList.add('hidden')});$('search').addEventListener('input',renderLibrary);$('detailClose').onclick=closeDetail;$('detailSheet').addEventListener('click',function(e){if(e.target===$('detailSheet'))closeDetail()});$('deleteBtn').onclick=async function(){if(!currentDetail||!confirm('Delete this local capture?'))return;await deleteEntry(currentDetail.id);closeDetail();renderLibrary()};$('copyBtn').onclick=async function(){if(!currentDetail)return;var tx=currentDetail.title+'\n\n'+(currentDetail.summary||currentDetail.transcript||'')+(currentDetail.actions&&currentDetail.actions.length?'\n\nActions:\n- '+currentDetail.actions.join('\n- '):'');try{await navigator.clipboard.writeText(tx);$('copyBtn').textContent='Copied';setTimeout(function(){$('copyBtn').textContent='Copy summary'},1200)}catch(e){alert('Copy was not available.')}};$('exportBtn').onclick=exportMemory;$('clearBtn').onclick=async function(){if(!confirm('Delete every BHW Capture entry and locally stored recording on this device?'))return;if(!confirm('This cannot be undone. Delete all local captures?'))return;await clearEntries();filterProject='All';renderLibrary()};
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferredInstall=e;$('installBtn').style.display='inline-flex'});$('installBtn').onclick=async function(){if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installBtn').style.display='none'};window.addEventListener('appinstalled',function(){$('installBtn').style.display='none'});if('serviceWorker'in navigator)navigator.serviceWorker.register('/bhw-capture-sw.js').catch(function(){});
}
bind();openDB().then(function(){if(sessionStorage.getItem('bhw_capture_unlocked')==='1')unlock();else openGate()}).catch(function(e){$('gateError').textContent='Local storage could not start: '+e.message});
})();
