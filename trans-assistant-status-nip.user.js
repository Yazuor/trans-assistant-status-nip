// ==UserScript==
// @name         Trans Assistant - Status NIP
// @namespace    https://github.com/Yazuor/trans-assistant-status-nip
// @version      1.0.4
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
    const VERSION='1.0.4';
    // New protocol also invalidates potentially false negative results from 1.0.0.
    const PREFIX = 'ta-status-nip:v2:', WAKE = PREFIX + 'wake';
    const BADGE = 'ta-status-nip-badge', FRAME_PARAM = 'taStatusNipFrame';
    const CACHE_MS = 5 * 60 * 1000, REQUEST_MS = 30000;
    const instance = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const capturedChunks=new WeakSet();
    const patchedOwners=new WeakSet();
    let localServices=null;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const text = value => String(value ?? '').trim();
    const fold = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase();
    const escape = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const pageFunction = (fn, scope=page) => typeof exportFunction === 'function' ? exportFunction(fn,scope) : fn;
    const pageObject = (value, scope=page) => typeof cloneInto === 'function' ? cloneInto(value,scope,{cloneFunctions:true,wrapReflectors:true}) : value;
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
            let listener, timer, poll, acknowledged=false, settled = false;
            const started=Date.now();
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                clearInterval(poll);
                if (listener !== undefined) GM_removeValueChangeListener(listener);
                GM_deleteValue(key);
                error ? reject(error) : resolve(result);
            };
            const receive = result => {
                if (result?.id !== id || result.nip !== nip) return;
                if(result.state==='processing')acknowledged=true;
                if(result.state!=='done')return;
                if (result.error) finish(new Error(`${result.error} [intranet ${result.workerVersion||'starsza wersja'}]`));
                else if (['client','carrier','blocked'].every(field => typeof result[field] === 'boolean')) finish(null, result);
            };
            listener = GM_addValueChangeListener(key, (_key, _old, result) => receive(result));
            // Only while this request is pending: recover a missed GM notification.
            // These are local extension reads, not requests to the intranet.
            poll=setInterval(()=>{
                receive(GM_getValue(key,null));
                if(settled)return;
                if(!acknowledged&&Date.now()-started>=8000)finish(new Error('Karta intranetu nie odebrała zapytania. Przejdź na nią i sprawdź, czy Status NIP jest tam włączony oraz zaktualizowany.'));
                else if(!acknowledged)GM_setValue(WAKE,id+':'+Date.now());
            },1000);
            timer = setTimeout(() => finish(new Error(acknowledged?'Intranet odebrał zapytanie, ale nie zakończył sprawdzania w ciągu 30 s.':'Otwórz zalogowaną kartę intranetu w tym samym profilu przeglądarki i spróbuj ponownie.')), REQUEST_MS);
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
                    if (current?.owner === instance && current.id === job.id) GM_setValue(key, {...job, ...result, workerVersion:VERSION, state:'done'});
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
        const doc=frame.contentDocument,input=doc?.querySelector(selector);
        if(!input)throw new Error('Brak wyszukiwarki intranetu. Sprawdź logowanie.');
        const w=frame.contentWindow.wrappedJSObject||frame.contentWindow;
        const method=selector==='#k_id'?'autosuggest2':'autosuggest_przewoznik';
        const xhr=w.http;
        if(typeof w[method]!=='function'||!xhr?.addEventListener)throw new Error('Nie znaleziono natywnej funkcji wyszukiwania intranetu: '+method+'.');
        input.value=nip;
        return new Promise((resolve,reject)=>{
            let settled=false,started=false;
            const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);xhr.removeEventListener('loadend',listener,false);error?reject(error):resolve(result);};
            const listener=pageFunction(()=>{
                if(!started||xhr.readyState!==4)return;
                try{
                    const status=Number(xhr.status)||0;
                    if(status<200||status>=300)return finish(new Error('Wyszukiwarka intranetu: HTTP '+status+'.'));
                    const body=String(xhr.responseText||''),parsed=new DOMParser().parseFromString(body,'text/html');
                    const links=Array.from(parsed.querySelectorAll('a'));
                    const exact=links.filter(link=>exactNipInText(link.textContent,nip));
                    if(exact.length>1)return finish(new Error('Kilka wyników dla tego NIP-u. Sprawdź firmę w intranecie.'));
                    if(exact.length===1){
                        const matches=Array.from(doc.querySelectorAll('#results3 a')).filter(link=>exactNipInText(link.textContent,nip));
                        if(matches.length===1)return finish(null,{link:matches[0],input});
                        return finish(new Error('Odpowiedź zawiera NIP, ale lista intranetu nie została uzupełniona.'));
                    }
                    const list=parsed.body.children.length===1&&parsed.body.firstElementChild.tagName==='UL';
                    const clean=!parsed.querySelector('form,input,script')&&!/fatal error|warning:|ora-\d|sqlstate/i.test(body);
                    // A completed native search may return an empty body, an empty
                    // list, a list with a no-result label, or other NIP matches.
                    const otherNips=links.length>0&&links.every(link=>/\b(?:PL[\s-]*)?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/i.test(link.textContent));
                    const noResults=/^(?:brak\b.*|nie znaleziono\b.*|no results\b.*)$/i.test(fold(parsed.body.textContent));
                    if(!text(body)||clean&&(list&&(!links.length||otherNips)||noResults))return finish(null,{link:null,input});
                    finish(new Error('Nierozpoznana odpowiedź wyszukiwarki '+selector+' (HTTP '+status+', listy: '+parsed.querySelectorAll('ul').length+', odnośniki: '+links.length+').'));
                }catch(error){finish(error);}
            },w);
            const timer=setTimeout(()=>finish(new Error('Natywna wyszukiwarka intranetu nie odpowiedziała: '+method+'.')),10000);
            try{
                xhr.addEventListener('loadend',listener,false);
                started=true;
                w[method]();
            }catch(error){finish(error);}
        });
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
            const data=new FormData(form);
            if(button.name)data.append(button.name,button.value||'');
            const method=text(form.method||'POST').toUpperCase();
            if(!['GET','POST'].includes(method))throw new Error('Nieobsługiwany formularz klienta.');
            if(method==='GET')for(const [key,value] of data)url.searchParams.append(key,String(value));
            const response=await fetch(url.href,{method,credentials:'same-origin',...(method==='POST'?{body:data}:{}),signal:AbortSignal.timeout(10000)});
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
        if(found&&localServices!==found){localServices=found;
            try{page.__TA_STATUS_NIP_SERVICES__=found;}catch{/* Keep the local capture if cross-compartment assignment is restricted. */}
            queueMicrotask(()=>window.dispatchEvent(new Event('ta-status-nip-services')));
        }
        return found;
    }
    function patchServices(target){
        if(!target)return;
        captureServices(target);
        const owner=typeof target.prototype?.setup==='function'?target.prototype:target;
        if(typeof owner.setup!=='function'||patchedOwners.has(owner))return;
        const original=owner.setup;
        const wrapped=pageFunction(function(...args){
            const result=original.apply(this,args);
            captureServices(this);captureServices(result);
            if(result?.then)result.then(value=>captureServices(value),()=>{});
            return result;
        });
        owner.setup=wrapped;patchedOwners.add(owner);
    }
    function discoverServices(){
        if(localServices||captureServices(page.__TA_STATUS_NIP_SERVICES__))return;
        // Same known service module as Assistant Core. Never execute arbitrary
        // module IDs or invoke service setup ourselves.
        for(const key of Object.keys(page).filter(key=>/^webpackChunkWebMessenger$/i.test(key))){
            const chunk=page[key];if(!Array.isArray(chunk)||capturedChunks.has(chunk))continue;
            let req;chunk.push(pageObject([[`status-nip-${instance}-${Math.random().toString(36).slice(2)}`],{},runtime=>{req=runtime;}]));
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
        const direct=serviceContainer(runtime?.services)||localServices||serviceContainer(page.__TA_STATUS_NIP_SERVICES__);
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
            try{subscription=value.subscribe(pageObject(observer));}catch{subscription=value.subscribe(pageFunction(observer.next),pageFunction(observer.error),pageFunction(observer.complete));}
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
        let startupAt=Date.now();
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
            badge.title=label+` · Status NIP ${VERSION}`+' · Kliknij, aby skopiować NIP. Prawy przycisk: odśwież status.';
            badge.setAttribute('aria-label',label);badge.dataset.state=status;badge.dataset.nip=current.nip||'';
            const markup=`<span class="ta-nip-line"><span>NIP</span><strong>${escape(current.nip||'…')}</strong><i aria-hidden="true">⧉</i></span><span class="ta-nip-status ${status}">${entry?.client?icon('client'):''}${entry?.carrier?icon('carrier'):''}<i class="${status==='loading'?'ta-nip-spinner':'ta-nip-dot'}" aria-hidden="true"></i><span class="ta-nip-sr">${escape(label)}</span></span>`;
            if(badge.innerHTML!==markup)badge.innerHTML=markup;
            const host=hostFor(current.partner);
            if(host){if(getComputedStyle(host).position==='static')host.classList.add('ta-nip-host');if(badge.parentElement!==host)host.appendChild(badge);}
        }
        async function refresh(force=false){
            const identity=popupIdentity();if(!identity){current=null;document.getElementById(BADGE)?.remove();return;}
            const key=JSON.stringify(identity),token=++generation;
            if(current?.identity!==key){companyAttempts=0;startupAt=Date.now();current={identity:key,nip:'',partner:null};}
            if(force){companyAttempts=0;startupAt=Date.now();current.error='';current.result=null;}
            if(companyAttempts>=3&&!force){draw();return;}
            clearTimeout(timer);
            let runtime,companyId,services;
            try{discoverServices();runtime=findRuntime(identity);companyId=text(runtime?.interlocutor?.companyId||runtime?.interlocutor?.transId?.companyId);services=availableServices(runtime);}
            catch{current.error='Przeglądarka nie udostępniła danych Messengera. Odśwież rozmowę i sprawdź uprawnienia skryptu.';timer=-1;draw();return;}
            if(!runtime||!companyId||!services){
                if(Date.now()-startupAt>=25000){current.error='Nie odczytano firmy z Messengera. Odśwież rozmowę lub ponów odczyt prawym przyciskiem.';timer=-1;draw();return;}
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
        try{discoverServices();}catch{}
        let discoveryAttempts=0;
        const discoveryTimer=setInterval(()=>{try{discoverServices();}catch{}if(localServices||++discoveryAttempts>=30)clearInterval(discoveryTimer);},1000);
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
