/**
 * Admin Analytics Dashboard — HTML template
 *
 * Extracted from routes/health.js for maintainability and security review.
 * Uses textContent/DOM APIs exclusively — no innerHTML with user data.
 *
 * 2026-04-14: accepts a `nonce` in options and propagates it to inline
 * <style> and <script> tags so the strict nonce-based CSP (set in
 * routes/health.js) allows them. If nonce is empty string, tags render
 * without a nonce attribute for backwards compatibility.
 */

interface DashboardOptions {
  nonce?: string;
}

export function renderAnalyticsDashboard(origin: string, options: DashboardOptions = {}): string {
  const nonce = typeof options.nonce === 'string' ? options.nonce : '';
  const n = nonce ? ` nonce="${nonce}"` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Festie Analytics</title>
<style${n}>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f0f0f;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:20px}
.container{max-width:1000px;margin:0 auto}
h1{font-size:24px;margin-bottom:20px;color:#ff3366}
h2{font-size:16px;color:#00e8d0;margin:24px 0 12px;text-transform:uppercase;letter-spacing:1px}
.card{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:12px}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:16px;text-align:center}
.stat-value{font-size:32px;font-weight:700;color:#ff3366}
.stat-label{font-size:12px;color:#888;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px;border-bottom:2px solid #333;color:#888;font-size:11px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid #222}
.pri-must{color:#ff3366;font-weight:600}
.pri-want{color:#00e8d0}
.pri-maybe{color:#ffaa00}
.back-link{color:#00e8d0;text-decoration:none;font-size:13px}
.loading{text-align:center;padding:40px;color:#888}
</style></head><body>
<div class="container">
<a class="back-link" href="${origin}">&larr; Back to Festie</a>
<h1>Analytics Dashboard</h1>
<div id="stats" class="loading">Loading analytics...</div>
</div>
<script${n}>
(async()=>{
  try{
    const res=await fetch('/api/v1/admin/analytics',{credentials:'same-origin'});
    const{data}=await res.json();if(!data){document.getElementById('stats').textContent='Failed to load';return}
    const s=document.getElementById('stats');s.innerHTML='';

    function esc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML}
    function addCell(tr,text,cls){const td=document.createElement('td');td.textContent=String(text??'');if(cls)td.className=cls;tr.appendChild(td)}

    // Summary cards
    const totalUsers=data.activeUsers.length;
    const totalPicks=data.festivalStats.reduce((acc,f)=>acc+Number(f.totalPicks),0);
    const totalCrews=data.crews.length;
    const grid=document.createElement('div');grid.className='stat-grid';
    [{v:totalUsers,l:'Active Users'},{v:totalPicks,l:'Total Picks'},{v:totalCrews,l:'Crews'},{v:data.topSets.length>0?esc(data.topSets[0].artist):'\\u2014',l:'Most Picked Set'}].forEach(({v,l})=>{
      const c=document.createElement('div');c.className='stat-card';
      const vd=document.createElement('div');vd.className='stat-value';vd.textContent=String(v);
      const ld=document.createElement('div');ld.className='stat-label';ld.textContent=l;
      c.appendChild(vd);c.appendChild(ld);grid.appendChild(c);
    });s.appendChild(grid);

    // Top Sets
    if(data.topSets.length>0){
      const heading=document.createElement('h2');heading.textContent='Most Picked Sets';s.appendChild(heading);
      const t=document.createElement('table');
      t.innerHTML='<thead><tr><th>Artist</th><th>Must</th><th>Want</th><th>Maybe</th><th>Total</th></tr></thead>';
      const tb=document.createElement('tbody');
      data.topSets.forEach(r=>{const tr=document.createElement('tr');
        addCell(tr,r.artist);addCell(tr,r.mustCount,'pri-must');addCell(tr,r.wantCount,'pri-want');addCell(tr,r.maybeCount,'pri-maybe');addCell(tr,r.pickCount);
        tb.appendChild(tr);});t.appendChild(tb);s.appendChild(t);
    }

    // Active Users
    if(data.activeUsers.length>0){
      const heading=document.createElement('h2');heading.textContent='Active Users';s.appendChild(heading);
      const t=document.createElement('table');
      t.innerHTML='<thead><tr><th>Username</th><th>Profiles</th><th>Picks</th><th>Last Active</th></tr></thead>';
      const tb=document.createElement('tbody');
      data.activeUsers.forEach(r=>{const tr=document.createElement('tr');
        const la=r.lastActive?new Date(r.lastActive).toLocaleDateString():'\\u2014';
        addCell(tr,r.username);addCell(tr,r.profileCount);addCell(tr,r.totalPicks);addCell(tr,la);
        tb.appendChild(tr);});t.appendChild(tb);s.appendChild(t);
    }

    // Crews
    if(data.crews.length>0){
      const heading=document.createElement('h2');heading.textContent='Crews';s.appendChild(heading);
      const t=document.createElement('table');
      t.innerHTML='<thead><tr><th>Name</th><th>Members</th><th>Created</th></tr></thead>';
      const tb=document.createElement('tbody');
      data.crews.forEach(r=>{const tr=document.createElement('tr');
        addCell(tr,r.name);addCell(tr,r.memberCount);addCell(tr,new Date(r.createdAt).toLocaleDateString());
        tb.appendChild(tr);});t.appendChild(tb);s.appendChild(t);
    }
  }catch(e){document.getElementById('stats').textContent='Error: '+e.message}
})();
</script></body></html>`;
}

