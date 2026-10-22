(()=>{var l=(o,p)=>fetch(`/plugin/gatekeeper/${o}`,{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify(p||{})}),c=o=>String(o).replace(/[&<>"]/g,p=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[p]),k=`
  .gatekeeper { font-size: 90%; }
  .gatekeeper table { width: 100%; border-collapse: collapse; }
  .gatekeeper th, .gatekeeper td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #eee; }
  .gatekeeper .pending { background: #f5a623; color: #fff; border-radius: 8px; padding: 0 7px; font-size: 85%; }
  .gatekeeper .warning { color: #c0392b; font-size: 85%; }
  .gatekeeper .ids, .gatekeeper .pub, .gatekeeper .terms { cursor: pointer; border-bottom: 1px dotted #999; }
  .gatekeeper .terms { font-size: 85%; color: #888; }
  .gatekeeper .remove { cursor: pointer; color: #c0392b; border: 0; background: none; }
  .gatekeeper .bar { display: flex; gap: 6px; margin-top: 8px; align-items: center; flex-wrap: wrap; }
  .gatekeeper input[type=text] { flex: 1; min-width: 10em; padding: 2px 6px; }
  .gatekeeper button { padding: 2px 10px; }
  .gatekeeper .status { margin-top: 6px; font-size: 85%; color: #666; min-height: 1.2em; }
  .gatekeeper .status.err { color: #c0392b; }
  .gatekeeper .status.ok { color: #27ae60; }
`,b=(o,p)=>{o.html(`<style>${k}</style><div class="gatekeeper"><p>Gatekeeper \u2014 loading\u2026</p></div>`)},w=(o,p)=>{let g=()=>o.find(".gatekeeper"),n=(e,t)=>g().find(".status").attr("class",`status ${t||""}`).text(e),f=e=>{let t=(e.sites||[]).map(s=>{if(s.removed)return`<tr><td>${c(s.host)}</td><td colspan="4"><em>removed from config</em></td>
            <td><span class="pending">pending restart</span></td><td></td></tr>`;let i=(s.public_pages||[]).join(", "),a=s.require_terms||"";return`<tr data-host="${c(s.host)}">
          <td>${c(s.host)}</td>
          <td><input type="checkbox" class="restricted" ${s.restricted?"checked":""}></td>
          <td><span class="ids" title="click to edit allowed ids">${c((s.allowed_ids||[]).join(" ")||"\u2014")}</span></td>
          <td><span class="pub" title="click to edit the public (blessed) pages">${c(i||"\u2014")}</span>
            <div><span class="terms" title="click to set the must-read-before-login page">terms: ${c(a||"\u2014")}</span></div></td>
          <td>${s.warnings.map(h=>`<div class="warning">\u26A0 ${c(h)}</div>`).join("")}</td>
          <td>${s.pending?'<span class="pending">pending restart</span>':""}</td>
          <td><button class="remove" title="remove site from config">\xD7</button></td>
        </tr>`}).join(""),r=e.configEditedSinceBoot||(e.sites||[]).some(s=>s.pending);g().html(`
      <table>
        <tr><th>site</th><th>login-to-view</th><th>allowed ids</th><th>public pages</th><th></th><th></th><th></th></tr>
        ${t||'<tr><td colspan="7"><em>no wikiDomains entries in the config yet</em></td></tr>'}
      </table>
      <div class="bar">
        <input type="text" class="new-host" placeholder="add a site, e.g. private.example.com">
        <button class="add">add</button>
        ${r?'<button class="restart">restart farm</button>':""}
      </div>
      <div class="status"></div>
    `),r&&n(e.supervised?`Config changed since the farm started \u2014 restart to apply (${c(e.supervisor||"supervised")} will bring it back).`:"Config changed \u2014 no supervisor detected; restart with wiki-start --restart (button will offer force).")},d=()=>fetch("/plugin/gatekeeper/status.json",{credentials:"include",cache:"no-store"}).then(e=>{if(e.status===403)throw Object.assign(new Error("admin"),{admin:!0});return e.json()}).then(e=>{if(e.error&&e.readOnly){g().html(`<p><em>${c(e.error)}</em></p>`);return}m=e.processStarted,f(e)}).catch(e=>{e.admin?g().html("<p><em>Gatekeeper needs an admin login \u2014 log in with the site secret first.</em></p>"):g().html(`<p><em>gatekeeper unreachable: ${c(e.message)}</em></p>`)}),m=null,u=()=>{let e=Date.now();n("restarting\u2026");let t=()=>{if(Date.now()-e>12e4){n("server did not come back within 2 minutes \u2014 check the supervisor.","err");return}fetch("/plugin/gatekeeper/ping.json",{cache:"no-store"}).then(r=>r.json()).then(r=>{r.started&&r.started!==m?(n("back up \u2713","ok"),setTimeout(d,800)):setTimeout(t,2e3)}).catch(()=>setTimeout(t,2e3))};setTimeout(t,2e3)};o.on("change",".restricted",e=>{let t=e.target.closest("tr").dataset.host;l("toggle",{host:t,restricted:e.target.checked}).then(r=>r.ok?d():r.json().then(s=>n(s.error,"err"))).catch(r=>n(r.message,"err"))}),o.on("click",".ids",e=>{let t=e.target.closest("tr").dataset.host,r=e.target.textContent==="\u2014"?"":e.target.textContent,s=prompt(`Allowed ids for ${t} \u2014 space-separated ("*" = any logged-in user, empty = clear):`,r);if(s==null)return;let i=s.trim()?s.trim().split(/[\s]+/):[];l("allowed",{host:t,allowed_ids:i}).then(a=>a.ok?d():a.json().then(h=>n(h.error,"err"))).catch(a=>n(a.message,"err"))}),o.on("click",".pub",e=>{let t=e.target.closest("tr").dataset.host,r=e.target.textContent==="\u2014"?"":e.target.textContent,s=prompt(`Public (blessed) pages for ${t} \u2014 comma-separated page names a logged-out visitor may read (empty = splash only):`,r);if(s==null)return;let i=s.trim()?s.split(",").map(a=>a.trim()).filter(Boolean):[];l("allowed",{host:t,public_pages:i}).then(a=>a.ok?d():a.json().then(h=>n(h.error,"err"))).catch(a=>n(a.message,"err"))}),o.on("click",".terms",e=>{let t=e.target.closest("tr").dataset.host,r=e.target.textContent.replace(/^terms:\s*/,""),s=prompt(`Must-read-before-login page for ${t} \u2014 a page name, "true" for site-terms, empty to clear:`,r==="\u2014"?"":r);s!=null&&l("allowed",{host:t,require_terms:s.trim()}).then(i=>i.ok?d():i.json().then(a=>n(a.error,"err"))).catch(i=>n(i.message,"err"))}),o.on("click",".remove",e=>{let t=e.target.closest("tr").dataset.host;confirm(`Remove ${t} from the farm config's wikiDomains? (site data is untouched)`)&&l("site",{host:t,action:"remove"}).then(r=>r.ok?d():r.json().then(s=>n(s.error,"err"))).catch(r=>n(r.message,"err"))}),o.on("click",".add",()=>{let e=(o.find(".new-host").val()||"").trim().toLowerCase();e&&l("site",{host:e,action:"add"}).then(t=>t.ok?d():t.json().then(r=>n(r.error,"err"))).catch(t=>n(t.message,"err"))}),o.on("click",".restart",()=>{o.find("button, input").attr("disabled","disabled"),l("restart").then(e=>e.ok?u():e.status===409?e.json().then(t=>{confirm(`${t.error}

${t.hint}

Force the exit anyway?`)?l("restart",{force:!0}).then(r=>r.ok?u():n("restart refused","err")):(o.find("button, input").removeAttr("disabled"),n("restart cancelled \u2014 use wiki-start --restart from a shell.","err"))}):e.json().then(t=>n(t.error||"restart failed","err")))}),d()};typeof window<"u"&&(window.plugins=window.plugins||{},window.plugins.gatekeeper={emit:b,bind:w});})();
//# sourceMappingURL=gatekeeper.js.map
