import fs from 'node:fs';
const html = fs.readFileSync('public/index.html', 'utf8');
const js = html.split('<script>').pop().split('</script>')[0].replace(/^(const|let) /gm, 'var ').replace(/\nboot\(\);\s*$/, '\n');
globalThis.window = { scrollTo() {}, matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => ({ innerHTML: '' }) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { search: '' };
const A = new Function(`${js}\n return {T,TY,OB,patOf,propsOf,parse,RT};`)();
const lvl = { 1: 'Débutant', 2: 'Intermédiaire', 3: 'Confirmé (charges lourdes)', 4: 'Avancé (très lourd / très explosif)' };
const obj = { r: 'Renforcer', m: 'Mobilité', p: 'Explosivité', v: 'Prévenir' };
const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const head = ['Tendon', 'Exercice', 'Type', 'Niveau minimum', 'Séries × répétitions / durée', 'Charge (% de la charge max)', 'Repos (s)', 'Consigne affichée', 'Objectifs visés', 'Puissance estimée (1-5)', 'Animation', 'Accessoires', 'Validé par le professionnel (oui / non / à modifier)', 'Commentaire du professionnel'];
const rows = [head.map(q).join(';')];
for (const [k, t] of Object.entries(A.T)) {
  for (const e of t.x) {
    const pc = e.d.match(/(\d+)(?: à (\d+))? % de ta charge max/);
    const ty = { I: 'Isométrie', L: 'Force lente', E: 'Excentrique', P: 'Pliométrie / puissance', M: 'Mobilité', C: 'Chaîne et stabilité' }[e.t];
    const rest = /charge max|100 %/.test(e.d) ? 150 : (A.RT[A.TY[e.t]] || 60);
    rows.push([t.n, e.n, ty, lvl[e.l], e.d, pc ? (pc[2] ? `${pc[1]} à ${pc[2]} %` : `${pc[1]} %`) : '', rest, e.c, [...e.o].map((c) => obj[c]).join(', '), e.w, A.patOf(e.n), A.propsOf(e.n).join(' '), '', ''].map(q).join(';'));
  }
}
fs.writeFileSync('docs/validation-professionnel.csv', '\uFEFF' + rows.join('\r\n') + '\r\n');
console.log(rows.length - 1, 'exercices exportés');
