// ==UserScript==
// @name         Trans Assistant - Status NIP
// @namespace    https://github.com/Yazuor/trans-assistant-status-nip
// @version      1.0.0
// @description  NIP rozmówcy i status klienta/przewoźnika w intranecie. Bez Bridge i pozostałych modułów Trans Assistant.
// @author       Yazuor
// @match        https://platform.trans.eu/*
// @match        http://intranet/spedycja_uss_2022/*
// @match        https://intranet/spedycja_uss_2022/*
// @exclude      https://platform.trans.eu/challenge*
// @run-at       document-start
// @noframes
// @sandbox      JavaScript
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @homepageURL  https://github.com/Yazuor/trans-assistant-status-nip
// @supportURL   https://github.com/Yazuor/trans-assistant-status-nip/issues
// @downloadURL  https://raw.githubusercontent.com/Yazuor/trans-assistant-status-nip/main/trans-assistant-status-nip.user.js
// @updateURL    https://raw.githubusercontent.com/Yazuor/trans-assistant-status-nip/main/trans-assistant-status-nip.user.js
// ==/UserScript==

(() => {
    'use strict';
    if (window.top !== window) return;
    const page = unsafeWindow;
    const PREFIX = 'ta-status-nip:v1:', WAKE = PREFIX + 'wake';
    const BADGE = 'ta-status-nip-badge', FRAME_PARAM = 'taStatusNipFrame';
    const CACHE_MS = 5 * 60 * 1000, REQUEST_MS = 60000;
    const instance = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const capturedChunks=new WeakSet();
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const text = value => String(value ?? '').trim();
    const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase();
    const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    function nipDigits(value) {
        const valueText = text(value).replace(/^PL[\s-]*/i, '');
        if (!/^[\d\s-]+$/.test(valueText)) return '';
        const digits = valueText.replace(/\D/g, '');
        return /^\d{10}$/.test(digits) ? digits : '';
    }
    function exactNipInText(value, nip) {
        return Array.from(text(value).matchAll(/\b(?:PL[\s-]*)?(\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})\b/gi))
            .some(match => nipDigits(match[1]) === nip);
    }
    function cacheKey(nip) { return PREFIX + 'cache:' + nip; }
    function cached(nip) {
        const record = GM_getValue(cacheKey(nip), null);
        return record?.nip === nip && record.expiresAt > Date.now() &&
            ['client','carrier','blocked'].every(key => typeof record[key] === 'boolean') ? record : null;
    }

    if (location.hostname === 'intranet') {
        bootIntranet();
        return;
    }
    if (location.hostname !== 'platform.trans.eu') return;
    bootTrans();

    // The same installed userscript owns GM storage on both origins. Each request
    // has its own key; concurrent conversations never overwrite a shared mailbox.
    function requestStatus(nip, force = false) {
        const hit = !force && cached(nip);
        if (hit) return Promise.resolve(hit);
        const id = `${instance}-${Math.random().toString(36).slice(2)}`;
        const key = PREFIX + 'request:' + id;
        return new Promise((resolve, reject) => {
            let listener, timer, settled = false;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (listener !== undefined) GM_removeValueChangeListener(listener);
                GM_deleteValue(key);
                error ? reject(error) : resolve(result);
            };
            listener = GM_addValueChangeListener(key, (_key, _old, result) => {
                if (result?.id !== id || result.nip !== nip || result.state !== 'done') return;
                if (result.error) finish(new Error(result.error));
                else if (['client','carrier','blocked'].every(field => typeof result[field] === 'boolean')) finish(null, result);
            });
            timer = setTimeout(() => finish(new Error('Otwórz zalogowaną kartę intranetu w tym samym profilu Chrome i spróbuj ponownie.')), REQUEST_MS);
            GM_setValue(key, {id, nip, state:'pending', createdAt:Date.now(), force});
            GM_setValue(WAKE, id);
        });
    }

    function bootIntranet() {
        let running = false, retryTimer = 0;
        const leaseKey = PREFIX + 'worker';
        const readLease = () => { try { return JSON.parse(localStorage.getItem(leaseKey)); } catch { return null; } };
        const pending = () => GM_listValues().filter(key => key.startsWith(PREFIX + 'request:'))
            .map(key => ({key, job:GM_getValue(key, null)})).filter(({key,job}) => {
                if (!job || Date.now() - job.createdAt > REQUEST_MS + 15000) { GM_deleteValue(key); return false; }
                return job.state === 'pending' || job.state === 'processing';
            }).sort((a,b) => a.job.createdAt - b.job.createdAt);
        async function drain() {
            if (running || !document.body || !pending().length) return;
            clearTimeout(retryTimer); retryTimer=0;
            running = true;
            let heartbeat;
            try {
                const lease = readLease();
                if (lease && lease.owner !== instance && lease.until > Date.now()) {
                    clearTimeout(retryTimer); retryTimer = setTimeout(drain, 5000); return;
                }
                localStorage.setItem(leaseKey, JSON.stringify({owner:instance, until:Date.now()+45000}));
                await sleep(80);
                if (readLease()?.owner !== instance) return;
                heartbeat = setInterval(() => {
                    if (readLease()?.owner === instance) localStorage.setItem(leaseKey, JSON.stringify({owner:instance, until:Date.now()+45000}));
                }, 10000);
                for (const {key,job} of pending()) {
                    if (readLease()?.owner !== instance) break;
                    if (nipDigits(job.nip) !== job.nip) { GM_deleteValue(key); continue; }
                    const latest = GM_getValue(key, null);
                    if (!latest || latest.state === 'done' || latest.state === 'processing' && latest.claimUntil > Date.now()) continue;
                    GM_setValue(key, {...job, state:'processing', owner:instance, claimUntil:Date.now()+45000});
                    await sleep(80);
                    if (GM_getValue(key, null)?.owner !== instance) continue;
                    let result;
                    try {
                        result = !job.force && cached(job.nip);
                        if (!result) {
                            const [client,carrier] = await Promise.all([inspectClient(job.nip), inspectCarrier(job.nip)]);
                            result = {nip:job.nip, client:client.client, blocked:client.blocked, carrier:carrier.carrier, expiresAt:Date.now()+CACHE_MS};
                            GM_setValue(cacheKey(job.nip), result);
                        }
                    } catch (error) { result = {error:error.message || 'Nie udało się sprawdzić intranetu.'}; }
                    const current = GM_getValue(key, null);
                    if (current?.owner === instance && current.id === job.id) GM_setValue(key, {...job, ...result, state:'done'});
                }
            } catch (error) { console.warn('[Status NIP] Sprawdź dostęp do zalogowanego intranetu.', error.message); }
            finally {
                clearInterval(heartbeat);
                if (readLease()?.owner === instance) localStorage.removeItem(leaseKey);
                running = false;
                if (pending().length && !retryTimer) retryTimer = setTimeout(drain, 1000);
            }
        }
        GM_addValueChangeListener(WAKE, () => drain());
        window.addEventListener('storage', event => { if (event.key === leaseKey && !event.newValue) drain(); });
        window.addEventListener('focus', drain);
        window.addEventListener('pagehide', () => { if (readLease()?.owner === instance) localStorage.removeItem(leaseKey); });
        if (document.body) drain(); else document.addEventListener('DOMContentLoaded', drain, {once:true});
        // Clean expired cache entries on startup only; no idle server polling.
        for (const key of GM_listValues()) if (key.startsWith(PREFIX+'cache:') && GM_getValue(key,null)?.expiresAt < Date.now()) GM_deleteValue(key);
    }
    async function lookupFrame(pathname) {
        return new Promise((resolve,reject) => {
            const frame = document.createElement('iframe');
            const url = new URL(pathname, location.origin); url.searchParams.set(FRAME_PARAM,'1');
            frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
            frame.setAttribute('aria-hidden','true'); frame.tabIndex=-1;
            frame.style.cssText='position:fixed!important;left:-10000px!important;top:-10000px!important;width:1px!important;height:1px!important;border:0!important;opacity:0!important;pointer-events:none!important';
            const timer=setTimeout(()=>{frame.remove();reject(new Error('Intranet nie odpowiedział. Sprawdź logowanie.'));},12000);
            frame.addEventListener('load',()=>{clearTimeout(timer);resolve(frame);},{once:true});
            frame.src=url.href;document.documentElement.appendChild(frame);
        });
    }
    async function autocomplete(frame, selector, nip) {
        const doc=frame.contentDocument, input=doc?.querySelector(selector);
        if (!input) throw new Error('Brak wyszukiwarki intranetu. Sprawdź logowanie.');
        const w=frame.contentWindow;
        input.value=nip;
        input.dispatchEvent(new w.Event('input',{bubbles:true}));
        input.dispatchEvent(new w.KeyboardEvent('keyup',{bubbles:true,key:nip.slice(-1),code:`Digit${nip.slice(-1)}`}));
        input.dispatchEvent(new w.Event('change',{bubbles:true}));
        const start=Date.now();
        while(Date.now()-start<8500){
            const box=doc.querySelector('#results3');
            const matches=Array.from(box?.querySelectorAll('a')||[]).filter(link=>exactNipInText(link.textContent,nip));
            if(matches.length>1)throw new Error('Kilka wyników dla tego NIP-u. Sprawdź firmę w intranecie.');
            if(matches.length===1)return {link:matches[0],input};
            if(box?.querySelector('ul') && box.style.display!=='none')return {link:null,input};
            await sleep(120);
        }
        throw new Error('Wyszukiwanie w intranecie nie zwróciło wyniku.');
    }
    async function inspectClient(nip) {
        const frame=await lookupFrame('/spedycja_uss_2022//oferta/dodanie.php');
        try{
            const {link,input}=await autocomplete(frame,'#k_id',nip);
            if(!link)return {client:false,blocked:false};
            link.click();
            const start=Date.now();
            while(!/^\d+$/.test(input.value) || input.value===nip){if(Date.now()-start>4000)throw new Error('Nie udało się wybrać klienta.');await sleep(80);}
            const form=input.form;
            const button=Array.from(form?.querySelectorAll('input[type="submit"],button[type="submit"]')||[]).find(b=>fold(b.value||b.textContent)==='wybierz');
            if(!form||!button)throw new Error('Brak przycisku wyboru klienta.');
            const url=new URL(form.getAttribute('action')||frame.contentWindow.location.href,frame.contentWindow.location.href);
            if(url.origin!==location.origin || !url.pathname.startsWith('/spedycja_uss_2022/'))throw new Error('Nieprawidłowy adres formularza klienta.');
            const data=new frame.contentWindow.FormData(form);
            if(button.name)data.append(button.name,button.value||'');
            const method=text(form.method||'POST').toUpperCase();
            if(!['GET','POST'].includes(method))throw new Error('Nieobsługiwany formularz klienta.');
            if(method==='GET')for(const [key,value] of data)url.searchParams.append(key,String(value));
            const response=await frame.contentWindow.fetch(url.href,{method,credentials:'same-origin',...(method==='POST'?{body:data}:{}),signal:AbortSignal.timeout(10000)});
            if(!response.ok)throw new Error(`Intranet: HTTP ${response.status}.`);
            const html=await response.text();
            const active=/<form\b[^>]*\bname=["']?add_offer["']?/i.test(html);
            const blocked=/klient\s+zablokowany|zablokowan(?:y|a|e)|blokad/i.test(html);
            if(!active&&!blocked)throw new Error('Nie rozpoznano statusu klienta. Sprawdź logowanie.');
            return {client:true,blocked};
        }finally{frame.remove();}
    }
    async function inspectCarrier(nip) {
        const frame=await lookupFrame('/spedycja_uss_2022//zlecenie/wyszukiwanie.php');
        try{return {carrier:Boolean((await autocomplete(frame,'#przewoznik',nip)).link)};}
        finally{frame.remove();}
    }

    function popupIdentity(){
        if(!location.pathname.includes('/messenger-client/'))return null;
        const match=location.hash.match(/^#(\d+)-([a-z][a-z0-9_-]*?)(?:-(\d+))?(?:[?&].*)?$/i);
        return match?{accountId:Number(match[1]),domain:match[2].toLowerCase(),contextId:match[3]||''}:null;
    }
    function matchingRuntime(value,identity){
        const id=value?.conversationWindowId;
        return id && Number(id.interlocutorId)===identity.accountId &&
            text(id.contextsDomainId||'freight').toLowerCase()===identity.domain && text(id.contextId)===identity.contextId;
    }
    function serviceContainer(value,depth=0,seen=new Set()){
        if(!value||typeof value!=='object'||depth>3||seen.has(value))return null;
        seen.add(value);
        if(typeof value.companiesApiV2Service?.getCompany==='function'||typeof value.companyInfoService?.getInfo==='function')return value;
        for(const key of ['services','container','baseServices','default','NegotiationForMessenger']){
            const found=serviceContainer(value[key],depth+1,seen);if(found)return found;
        }
        return null;
    }
    function captureServices(value){
        const found=serviceContainer(value);
        if(found && page.__TA_STATUS_NIP_SERVICES__!==found){page.__TA_STATUS_NIP_SERVICES__=found;queueMicrotask(()=>window.dispatchEvent(new Event('ta-status-nip-services')));}
        return found;
    }
    function patchServices(target){
        if(!target)return;
        captureServices(target);
        const owner=typeof target.prototype?.setup==='function'?target.prototype:target;
        if(typeof owner.setup!=='function'||owner.setup.__statusNipPatched)return;
        const original=owner.setup;
        const wrapped=function(...args){
            const result=original.apply(this,args);
            captureServices(this);captureServices(result);
            if(result?.then)result.then(value=>captureServices(value),()=>{});
            return result;
        };
        wrapped.__statusNipPatched=true;owner.setup=wrapped;
    }
    function discoverServices(){
        if(captureServices(page.__TA_STATUS_NIP_SERVICES__))return;
        // Same known service module as Assistant Core. Never execute arbitrary
        // module IDs or invoke service setup ourselves.
        for(const key of Object.keys(page).filter(key=>/^webpackChunkWebMessenger$/i.test(key))){
            const chunk=page[key];if(!Array.isArray(chunk)||capturedChunks.has(chunk))continue;
            let req;chunk.push([[`status-nip-${instance}-${Math.random().toString(36).slice(2)}`],{},runtime=>{req=runtime;}]);
            if(typeof req!=='function')continue;
            try{const mod=req('8076');
                capturedChunks.add(chunk);
                if(mod?.then)mod.then(m=>{patchServices(m?.default);patchServices(m?.NegotiationForMessenger);patchServices(m);},()=>{});
                else{patchServices(mod?.default);patchServices(mod?.NegotiationForMessenger);patchServices(mod);}
            }catch{/* Late-loaded runtimes will also be inspected through React. */}
        }
    }
    function findRuntime(identity){
        const doc=page.document,walker=doc.createTreeWalker(doc,1),fibers=[],seen=new Set();
        for(let count=0;count<1600;count++){
            const node=walker.nextNode();if(!node)break;
            for(const key of Object.keys(node))if(/^__(reactFiber|reactInternalInstance|reactContainer)\$/i.test(key)){
                const fiber=node[key];if(fiber&&!seen.has(fiber)){seen.add(fiber);fibers.push(fiber);}
            }
        }
        let best=null,score=-1;
        function visit(value,depth=0,visited=new Set()){
            if(!value||typeof value!=='object'||depth>4||visited.has(value))return;
            visited.add(value);captureServices(value);
            if(matchingRuntime(value,identity)){
                const company=text(value.interlocutor?.companyId||value.interlocutor?.transId?.companyId);
                const rank=(company?20:0)+(serviceContainer(value.services)?10:0)+(value.interlocutor?5:0);
                if(rank>score){best=value;score=rank;}
            }
            for(const key of ['props','children','value','data','context','conversation','conversationWindow','focusedWindow'])visit(value[key],depth+1,visited);
        }
        for(let index=0;index<fibers.length&&index<6000;index++){
            const f=fibers[index];
            for(const value of [f.memoizedProps,f.pendingProps,f.memoizedState,f.stateNode?.props,f.stateNode?.state])visit(value);
            for(const next of [f.child,f.sibling,f.return,f.alternate,f._debugOwner])if(next&&!seen.has(next)){seen.add(next);fibers.push(next);}
        }
        return best;
    }
    function availableServices(runtime){
        const roots=[page];try{if(page.opener)roots.push(page.opener);}catch{}
        const direct=serviceContainer(runtime?.services)||serviceContainer(page.__TA_STATUS_NIP_SERVICES__);
        if(direct)return direct;
        for(const root of roots){try{const found=serviceContainer(root.__TA_STATUS_NIP_SERVICES__);if(found)return found;}catch{}}
        return null;
    }
    function serviceResult(value){
        if(!value?.subscribe)return Promise.resolve(value);
        return new Promise((resolve,reject)=>{
            let subscription,settled=false;
            const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);subscription?.unsubscribe?.();error?reject(error):resolve(result);};
            const timer=setTimeout(()=>finish(new Error('Przekroczono czas pobierania danych firmy.')),6000);
            const observer={next:value=>finish(null,value),error:error=>finish(error),complete:()=>finish(null,null)};
            try{subscription=value.subscribe(observer);}catch{subscription=value.subscribe(observer.next,observer.error,observer.complete);}
            if(settled)subscription?.unsubscribe?.();
        });
    }
    function extractNip(value){
        for(let depth=0;depth<4;depth++){
            if(!value||typeof value!=='object')break;
            const found=value.data||value.result||value.body;if(found&&typeof found==='object')value=found;else break;
        }
        const get=path=>path.split('.').reduce((v,key)=>v?.[key],value);
        for(const path of ['vatIdentification.number','vatIdentification.value','vatIdentification.id','vatIdentification','company.vatIdentification.number','company.vatIdentification.value','company.vatIdentification','taxIdentificationNumber','company.taxIdentificationNumber','nip','company.nip']){
            const nip=nipDigits(get(path));if(nip)return nip;
        }
        return '';
    }
    async function readCompanyNip(services,companyId){
        for(const [service,method] of [[services?.companiesApiV2Service,'getCompany'],[services?.companyInfoService,'getInfo']]){
            if(typeof service?.[method]!=='function')continue;
            try{const result=await Promise.race([serviceResult(service[method].call(service,companyId)),sleep(7000).then(()=>{throw new Error('Brak odpowiedzi Transa.');})]);
                const nip=extractNip(result);if(nip)return nip;
            }catch{/* Try the second proven native company service. */}
        }
        throw new Error('Nie udało się odczytać NIP-u firmy z Transa.');
    }
    function icon(kind){
        const carrier=kind==='carrier';
        const shape=carrier?'<path d="M2 5.5h10v6H2zM12 8h3l2 2v1.5h-5zM5 14a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 5 14Zm9 0a1.6 1.6 0 1 0 0-3.2A1.6 1.6 0 0 0 14 14Z"/>':'<path d="M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7c.2-3 2.1-4.7 5-4.7s4.8 1.7 5 4.7H4Z"/>';
        const label=carrier?'W bazie jako przewoźnik':'W bazie jako klient';
        return `<span class="ta-nip-icon" title="${label}" aria-label="${label}"><svg viewBox="0 0 18 18" aria-hidden="true">${shape}</svg></span>`;
    }
    function bootTrans(){
        let generation=0,current=null,timer=0,scheduled=false,companyAttempts=0;
        const style=document.createElement('style');style.textContent=badgeCss();document.documentElement.appendChild(style);
        function hostFor(partner){
            const hints=[partner?.givenName,partner?.familyName,partner?.mobile].map(fold).filter(h=>h.length>=4);
            let best=null,rank=-Infinity;
            for(const node of document.querySelectorAll('header,[class*="Header"],[class*="header"],section,div')){
                if(node.closest('#'+BADGE))continue;
                const rect=node.getBoundingClientRect();
                if(rect.width<240||rect.height<38||rect.height>170||rect.top>190||!node.getClientRects().length)continue;
                const hits=hints.filter(h=>fold(node.textContent).includes(h)).length;
                const score=hits*100+(/header/i.test(node.className||node.tagName)?40:0)-rect.height/10;
                if(score>rank&&hits){best=node;rank=score;}
            }
            return best||document.body;
        }
        function draw(){
            if(!current||!popupIdentity()||JSON.stringify(popupIdentity())!==current.identity){document.getElementById(BADGE)?.remove();return;}
            let badge=document.getElementById(BADGE);
            if(!badge){badge=document.createElement('button');badge.id=BADGE;badge.type='button';
                badge.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();
                    if(current?.nip){GM_setClipboard(current.nip,'text');badge.title='Skopiowano NIP';}
                    else refresh(true);
                });badge.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();refresh(true);});}
            const entry=current.result;
            const status=current.error?'error':entry?.blocked?'blocked':entry&&(entry.client||entry.carrier)?'ok':entry?'missing':'loading';
            const label=current.error||(!current.nip?'Pobieranie NIP-u firmy…':!entry?'Sprawdzanie w intranecie':entry.blocked?'Kontrahent zablokowany':entry.client||entry.carrier?'Kontrahent aktywny':'Brak w bazie');
            badge.title=label+' · Kliknij, aby skopiować NIP. Prawy przycisk: odśwież status.';
            badge.setAttribute('aria-label',label);badge.dataset.state=status;badge.dataset.nip=current.nip||'';
            const markup=`<span class="ta-nip-line"><span>NIP</span><strong>${escape(current.nip||'…')}</strong><i aria-hidden="true">⧉</i></span><span class="ta-nip-status ${status}">${entry?.client?icon('client'):''}${entry?.carrier?icon('carrier'):''}<i class="${status==='loading'?'ta-nip-spinner':'ta-nip-dot'}" aria-hidden="true"></i><span class="ta-nip-sr">${escape(label)}</span></span>`;
            if(badge.innerHTML!==markup)badge.innerHTML=markup;
            const host=hostFor(current.partner);
            if(host){if(getComputedStyle(host).position==='static')host.classList.add('ta-nip-host');if(badge.parentElement!==host)host.appendChild(badge);}
        }
        async function refresh(force=false){
            const identity=popupIdentity();if(!identity){current=null;document.getElementById(BADGE)?.remove();return;}
            const key=JSON.stringify(identity),token=++generation;
            if(current?.identity!==key){companyAttempts=0;current={identity:key,nip:'',partner:null};}
            if(force){companyAttempts=0;current.error='';current.result=null;}
            if(companyAttempts>=3&&!force){draw();return;}
            clearTimeout(timer);discoverServices();
            const runtime=findRuntime(identity),companyId=text(runtime?.interlocutor?.companyId||runtime?.interlocutor?.transId?.companyId);
            const services=availableServices(runtime);
            if(!runtime||!companyId||!services){
                draw();timer=setTimeout(()=>refresh(),Math.min(10000,1000*Math.max(1,++startupAttempts)));return;
            }
            current.partner=runtime.interlocutor;draw();companyAttempts++;
            try{
                const nip=current.nip&&!force?current.nip:await readCompanyNip(services,companyId);
                if(token!==generation||JSON.stringify(popupIdentity())!==key)return;
                current.nip=nip;current.error='';draw();
                const result=await requestStatus(nip,force);
                if(token!==generation||JSON.stringify(popupIdentity())!==key)return;
                current.result=result;draw();
            }catch(error){
                if(token!==generation||JSON.stringify(popupIdentity())!==key)return;
                current.error=error.message;draw();
                if(!current.nip&&companyAttempts<3)timer=setTimeout(()=>refresh(),companyAttempts===1?5000:15000);
            }
        }
        let startupAttempts=0;
        const schedule=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;
            if(current?.nip){draw();return;}if(!timer)refresh();},250);};
        // Capture services in the main app too so detached conversation windows can
        // reuse the native service through their same-origin opener.
        discoverServices();
        let discoveryAttempts=0;
        const discoveryTimer=setInterval(()=>{discoverServices();if(page.__TA_STATUS_NIP_SERVICES__||++discoveryAttempts>=30)clearInterval(discoveryTimer);},1000);
        const observer=new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('#'+BADGE)))schedule();});
        observer.observe(document.documentElement,{childList:true,subtree:true});
        window.addEventListener('hashchange',()=>{generation++;clearTimeout(timer);timer=0;startupAttempts=0;refresh();});
        window.addEventListener('ta-status-nip-services',()=>{if(!current?.nip&&companyAttempts===0){clearTimeout(timer);timer=0;refresh();}});
        window.addEventListener('focus',()=>{if(current?.error){clearTimeout(timer);timer=0;refresh(true);}});
        GM_registerMenuCommand('Odśwież status NIP w rozmowie',()=>refresh(true));
        if(document.body)refresh();else document.addEventListener('DOMContentLoaded',()=>refresh(),{once:true});
    }
    function badgeCss(){return `
        .ta-nip-host{position:relative!important}
        #${BADGE}{position:absolute;top:8px;right:42px;z-index:2147483645;display:inline-flex;min-height:42px;padding:4px 7px 4px 8px;align-items:center;flex-direction:column;justify-content:center;gap:3px;border:1px solid #c9dced;border-radius:8px;background:rgba(246,250,255,.97);color:#173f75;box-shadow:0 3px 10px rgba(31,68,108,.12);cursor:pointer;font:11px/1.1 'Segoe UI',Arial,sans-serif}
        #${BADGE}:hover{border-color:#91b8dc;background:#eef6ff}
        #${BADGE} .ta-nip-line{display:inline-flex;align-items:center;gap:6px}
        #${BADGE} .ta-nip-line>span{color:#758aa2;font-size:9px;font-weight:800;letter-spacing:.05em}
        #${BADGE} .ta-nip-line>strong{color:#173f75;font-size:11px;font-weight:750}
        #${BADGE} .ta-nip-line>i{color:#2f73ba;font-size:13px;font-style:normal}
        #${BADGE} .ta-nip-status{display:flex;min-height:14px;align-items:center;justify-content:center;gap:4px}
        #${BADGE} .ta-nip-icon{display:inline-flex;width:16px;height:14px;align-items:center;justify-content:center;color:#356b9c}
        #${BADGE} .ta-nip-icon svg{width:16px;height:16px;fill:currentColor}
        #${BADGE} .ta-nip-dot{display:inline-block;width:7px;height:7px;margin-left:1px;border:1px solid rgba(255,255,255,.9);border-radius:50%;background:#98a8b8;box-shadow:0 0 0 1px rgba(83,105,127,.16)}
        #${BADGE} .ok .ta-nip-dot{background:#27b36a;box-shadow:0 0 0 1px rgba(39,179,106,.22)}
        #${BADGE} .blocked .ta-nip-dot{background:#e34d59;box-shadow:0 0 0 1px rgba(227,77,89,.22)}
        #${BADGE} .error .ta-nip-dot{background:#e5a62f}
        #${BADGE} .ta-nip-spinner{width:10px;height:10px;box-sizing:border-box;border:2px solid #cfdeec;border-top-color:#2f73ba;border-radius:50%;animation:ta-nip-spin .8s linear infinite}
        #${BADGE} .ta-nip-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}
        @keyframes ta-nip-spin{to{transform:rotate(360deg)}}
        @media(prefers-reduced-motion:reduce){#${BADGE} .ta-nip-spinner{animation:none}}
    `;}
})();
