// Oficina pixel art vista desde arriba: escritorios fijos del roster, llamar/despedir caminando y el director
// (si está configurado) en Dirección. Zonas, carteles y textos vienen de la configuración. El panel lo pone app.js (ganchos GH).
import{hormiga}from'./hormiga.js';
import{t as tr}from'./i18n.js';import{abeja}from'./abeja.js';import{calcLayout,C0}from'./plano.js';
let HOV=null,GH={abrir(){},llamar(){}},CFG={oficina:{zonas:[{nombre:'ZONA 1'},{nombre:'ZONA 2'},{nombre:'ZONA 3'}],carteles:[],tv:'TV'},director:null},L='es',ZP=[];
const T=(k,p)=>tr(L,k,p);
const RM=matchMedia('(prefers-reduced-motion:reduce)').matches;
const $=i=>document.getElementById(i);
const hash=s=>{let h=0;for(const c of String(s))h=h*31+c.charCodeAt(0)|0;return Math.abs(h)};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const PAL=['#a98bff','#4fd1c5','#ffd24d','#5aa9ff','#7be08a','#c58bff','#ff9d4d'];
const hms=d=>d.toLocaleTimeString('es-CO',{hour12:false});
function dur(ms){if(!(ms>0))return '—';const s=ms/1000|0;if(s<60)return s+' s';const m=s/60|0;if(m<60)return m+' min';return (m/60|0)+' h '+m%60+' min'}
const Q=new URLSearchParams(location.search);
function horaAhora(){const q=Q.get('h');if(q!==null)return +q;const d=new Date();return d.getHours()+d.getMinutes()/60+d.getSeconds()/3600}
// ===== Escena =====
const W=400,cv=$('cv'),X=cv.getContext('2d');let H=240,DY=0;cv.width=W;cv.height=H;
const mkc=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c};
const bg=mkc(),B=bg.getContext('2d'),dk=mkc(),D=dk.getContext('2d');
const R=(c,col,a,b,w,h)=>{c.fillStyle=col;c.fillRect(a|0,b|0,w|0,h|0)};
// fuente 3x5 (cada glifo: 5 dígitos octales = 5 filas de 3 bits)
const GL={A:'25755',B:'65656',C:'34443',D:'65556',E:'74647',F:'74644',G:'34553',H:'55755',I:'72227',J:'11152',K:'55655',L:'44447',M:'57755',N:'75555',O:'25552',P:'65644',Q:'25573',R:'65655',S:'34216',T:'72222',U:'55557',V:'55552',W:'55775',X:'55255',Y:'55222',Z:'71247',0:'75557',1:'26227',2:'61247',3:'61216',4:'55711',5:'74616',6:'34652',7:'71222',8:'25252',9:'25316','-':'00700',':':'02020','.':'00002','?':'61202'};
function tx(c,s,x,y,col){c.fillStyle=col;for(const ch of String(s).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase()){const g=GL[ch];if(g)for(let j=0;j<5;j++){const d=+g[j];for(let i=0;i<3;i++)if(d>>(2-i)&1)c.fillRect(x+i,y+j,1,1)}x+=4}}
const twid=s=>String(s).length*4-1;
function planta(c,x,y){const M=['..gg..g..','.ggggggg.','gg.gggg.g','.gggggggg','..gg.gg..','...gGg...','...gGg...','..ggGgg..','.bbbbbbb.','.bbbbbbb.','..bbbbb..','..bbbbb..'],C={g:'#4caf50',G:'#2e7d32',b:'#b5651d'};
 R(c,'#0003',x,y+11,10,2);M.forEach((r,j)=>[...r].forEach((k,i)=>{if(k!=='.')R(c,C[k],x+i,y+j,1,1)}))}
function poster(c,x,y,w,h,t,bgc,fg){R(c,'#1a1424',x-1,y-1,w+2,h+2);R(c,bgc,x,y,w,h);R(c,fg,x+1,y+1,w-2,1);tx(c,t,x+((w-twid(t))>>1),y+((h-5)>>1)+1,fg)}
// geometría
const POD0=12,PODW=96,AX=[86,182,278],corrT=71;let corrB=183;
// Distribución: hasta 6 zonas en 2 filas de 3 islas; cada isla crece por filas de 2 escritorios (siempre queda uno libre);
// los contratistas (columna derecha) crecen igual. La planta abierta se alarga y las salas de abajo bajan DY píxeles.
let LAY={nz:3,fz:[2,2,2],filas:[2,0],y0:[77,0],filasC:2,DY:0,hueco:-1};
const zfila=p=>p<3?0:1;
const seatXY=(p,i)=>[POD0+(p%3)*PODW+(i%2)*40,LAY.y0[zfila(p)]+7+(i>>1)*48];
const seatC=i=>[304+(i%2)*46,C0+7+(i>>1)*48];
const capZ=p=>(LAY.fz[p]??0)*2,capC=()=>LAY.filasC*2;
function usarLayout(L2){if(JSON.stringify(L2)===JSON.stringify(LAY))return false;LAY=L2;DY=L2.DY;H=240+DY;corrB=183+DY;
 for(const c of[cv,bg,dk])c.height=H;CAFE=[[24,205+DY],[50,205+DY],[76,205+DY]];$('cam').style.aspectRatio=`${W}/${H}`;paintBg();return true}
const GEN=[184,22],RACK=j=>[272+30*j,14];
const DOORX={m:70,d:198,s:326};
const WINS=[[156,9,12,10],[232,9,12,10],[16,9,16,10],[98,9,16,10],[24,188,16,10],[52,188,16,10],[278,188,16,10],[1,86,6,16],[1,116,6,16],[1,146,6,16]];
let ZON=[],PCOL=['#4b5e9c','#3f7d62','#7d4c86','#2f7a80','#8a4a5a','#5a6a2a'],PCOLC='#8a6a3a';
function paintBg(){const c=B;R(c,'#2a2238',0,0,W,H);
 // suelo de planta abierta + pasillos
 R(c,'#c9c3b6',8,66,384,120+DY);for(let y=66;y<186+DY;y+=8)for(let x=8;x<392;x+=8)if((x+y>>3)%2)R(c,'#bfb9ac',x,y,8,8);
 R(c,'#a58f7a',8,67,384,8);for(let x=10;x<390;x+=10)R(c,'#c3ad96',x,70,5,1);
 R(c,'#a58f7a',8,180+DY,384,6);
 // alfombras por zona
 // textura suave distinta por zona (puntos, rayas o cuadros)
 const tex=(x,y,w,h,v)=>{for(let j=y+12;j<y+h-3;j+=6)for(let i=x+2+(((j-y)/6)&1)*3*(v%2);i<x+w-2;i+=6)R(c,v===2?'#ffffff10':'#00000012',i,j,v===1?2:1,1)};
 const rug=(x,y,w,h,col,lab,v)=>{R(c,col,x,y,w,h);if(v!==undefined)tex(x,y,w,h,v);R(c,'#0003',x,y,w,2);R(c,'#ffffff18',x+2,y+2,w-4,1);R(c,'#00000030',x,y+h-2,w,2);tx(c,lab,x+((w-twid(lab))>>1),y+2,'#ffffffb0')};
 for(let p=0;p<LAY.nz;p++)rug(POD0+(p%3)*PODW-6,LAY.y0[zfila(p)],82,LAY.filas[zfila(p)]*48+2,CFG.oficina.zonas[p]?.color||PCOL[p%PCOL.length],ZON[p],p%3);
 // lo que sobra de cada isla (una zona más llena que sus vecinas) se decora: plantas, archivadores o carrito de café
 const deco=(x,y,k)=>{if(k%3===0){planta(c,x+6,y);planta(c,x+30,y);planta(c,x+54,y)}
  else if(k%3===1){for(const dx of[8,40]){R(c,'#0003',x+dx,y+17,16,2);R(c,'#8a8a96',x+dx,y,16,17);R(c,'#a0a0ac',x+dx,y,16,1);R(c,'#6a6a76',x+dx+2,y+3,12,4);R(c,'#6a6a76',x+dx+2,y+10,12,4);R(c,'#ccc',x+dx+7,y+4,2,1);R(c,'#ccc',x+dx+7,y+11,2,1)}}
  else{R(c,'#0003',x+16,y+17,34,2);R(c,'#6b4a2a',x+16,y+8,34,9);R(c,'#a8733a',x+16,y+8,34,1);R(c,'#34383f',x+20,y+2,8,6);R(c,'#a33',x+21,y+3,2,1);R(c,'#f2ead8',x+32,y+5,3,3);R(c,'#f2ead8',x+37,y+5,3,3);R(c,'#444',x+18,y+17,2,3);R(c,'#444',x+46,y+17,2,3)}};
 for(let p=0;p<LAY.nz;p++)for(let k=LAY.fz[p];k<LAY.filas[zfila(p)];k++)deco(POD0+(p%3)*PODW,LAY.y0[zfila(p)]+14+k*48,hash('d'+p+k));
 if(LAY.hueco>=0){const h=LAY.hueco,x=POD0+(h%3)*PODW-6,y=LAY.y0[zfila(h)],hh=LAY.filas[zfila(h)]*48+2;R(c,'#00000018',x,y,82,hh);// lugar libre para una zona nueva
  for(let k=0;k<82;k+=4){R(c,'#ffffff55',x+k,y,2,1);R(c,'#ffffff55',x+k,y+hh-1,2,1)}for(let k=0;k<hh;k+=4){R(c,'#ffffff55',x,y+k,1,2);R(c,'#ffffff55',x+81,y+k,1,2)}}
 rug(292,C0,100,175+DY-C0,PCOLC,ZON[ZON.length-1],1);
 for(let k=LAY.filasC;C0+(k+1)*48<=175+DY;k++)deco(300,C0+14+k*48,hash('c'+k)+1);
 // recepción junto a la entrada (su placa ENTRADA se pinta encima en cada cuadro)
 R(c,'#0003',334,87,50,2);R(c,'#6b4a2a',334,79,50,8);R(c,'#a8733a',334,79,50,1);R(c,'#8a5a2a',334,86,50,1);R(c,'#ccc',376,80,4,2);R(c,'#ffd24d',377,79,2,1);planta(c,298,77);
 // cuadros en la pared del pasillo
 for(const[x,col]of[[24,'#5aa9ff'],[112,'#7be08a'],[150,'#ffd24d'],[236,'#c58bff'],[290,'#4fd1c5'],[352,'#9fb0d0']]){R(c,'#3a2f22',x,66,10,6);R(c,col,x+1,67,8,4);R(c,'#ffffff40',x+1,67,8,1)}
 // paredes exteriores
 R(c,'#4b3f5e',0,0,W,6);R(c,'#4b3f5e',0,0,8,H);R(c,'#4b3f5e',392,0,8,H);R(c,'#4b3f5e',0,H-4,W,4);R(c,'#6b5b78',0,0,W,2);
 // habitaciones superiores: suelo
 const room=(x,y,w,h,f)=>{f(c,x,y,w,h)};
 room(8,22,120,42,(c,x,y,w,h)=>{R(c,'#46598f',x,y,w,h);for(let j=y;j<y+h;j+=4)for(let i=x;i<x+w;i+=4)if((i+j>>2)%2)R(c,'#41538a',i,j,4,4)});
 room(134,22,12,42,(c,x,y,w,h)=>R(c,'#c9c3b6',x,y,w,h));
 room(150,22,100,42,(c,x,y,w,h)=>{R(c,'#b98a55',x,y,w,h);for(let i=x;i<x+w;i+=6)R(c,'#a97b48',i,y,1,h);for(let j=y+5;j<y+h;j+=9)R(c,'#a97b48',x+(j%3)*2,j,5,1)});
 room(262,22,130,42,(c,x,y,w,h)=>{R(c,'#3b4252',x,y,w,h);for(let i=x;i<x+w;i+=8)R(c,'#2f3441',i,y,1,h);for(let j=y;j<y+h;j+=8)R(c,'#2f3441',x,j,w,1)});
 // paredes de fondo (con grosor, zócalo y sombra)
 const wall=(x,y,w,h,col,base)=>{R(c,col,x,y,w,h);R(c,'#ffffff30',x,y,w,1);R(c,base,x,y+h-3,w,3);R(c,'#00000028',x,y+h,w,3)};
 wall(8,6,120,16,'#d9d0bd','#8b6b4a');wall(134,6,12,16,'#d9d0bd','#8b6b4a');wall(150,6,100,16,'#d9c9a5','#6b4a2a');wall(262,6,130,16,'#252a38','#171a24');
 R(c,'#6b5b78',128,6,6,58);R(c,'#6b5b78',254,6,8,58);R(c,'#6b5b78',8,62,60,3);R(c,'#6b5b78',74,62,54,3);
 R(c,'#6b5b78',262,62,58,3);R(c,'#6b5b78',332,62,60,3);R(c,'#6b5b78',134,62,12,3);
 // vidrio de Dirección + puerta
 R(c,'#9fdcf055',146,6,4,58);R(c,'#9fdcf055',250,6,4,58);R(c,'#cfeefa',146,6,1,58);R(c,'#cfeefa',253,6,1,58);
 R(c,'#9fdcf055',150,60,38,4);R(c,'#9fdcf055',208,60,42,4);R(c,'#cfeefa',150,60,38,1);R(c,'#cfeefa',208,60,42,1);
 R(c,'#6b4a2a',186,58,2,7);R(c,'#6b4a2a',208,58,2,7);R(c,'#6b4a2a',186,57,24,2);
 // letreros de zona
 // reuniones: pizarra blanca, mesa, sillas
 R(c,'#8b8b95',43,8,46,15);R(c,'#f6f4ea',44,9,44,13);for(const[a,b,w,col]of[[47,11,16,'#d33'],[47,15,24,'#33a'],[66,11,10,'#2a2'],[47,19,12,'#d33'],[74,17,10,'#333']])R(c,col,a,b,w,1);
 R(c,'#0003',33,52,76,4);R(c,'#5a3a1a',30,44,76,10);R(c,'#8a5a2a',30,40,76,10);R(c,'#a8733a',30,40,76,1);
 for(const x of[38,56,74,92]){R(c,'#2f3f7a',x,33,9,6);R(c,'#4a5aa0',x,33,9,1);R(c,'#2f3f7a',x,56,9,5);R(c,'#4a5aa0',x,56,9,1)}
 // pasillo entre salas: dispensador de agua y planta
 R(c,'#0003',135,48,10,2);R(c,'#8aa0b4',136,38,8,12);R(c,'#cfe6f5',137,28,6,11);R(c,'#7ad0ff',138,29,4,8);R(c,'#445',139,43,2,2);
 planta(c,134,10);
 // dirección: alfombra, plantas, estantería
 R(c,'#7a2f3a',166,34,68,26);R(c,'#e4b44c',166,34,68,1);R(c,'#e4b44c',166,59,68,1);R(c,'#e4b44c',166,34,1,26);R(c,'#e4b44c',233,34,1,26);
 planta(c,153,44);planta(c,235,44);
 // servidores: racks, cables
 for(let j=0;j<4;j++){const[x,y]=RACK(j);R(c,'#0005',x-1,y+37,18,3);R(c,'#12151f',x,y,16,36);R(c,'#2b3144',x,y,16,1);for(let k=0;k<7;k++)R(c,'#222838',x+1,y+3+k*5,14,3)}
 R(c,'#e0c050',276,52,110,1);R(c,'#4fd1c5',280,55,100,1);for(let j=0;j<4;j++){R(c,'#e0c050',RACK(j)[0]+4,50,1,3);R(c,'#4fd1c5',RACK(j)[0]+10,50,1,6)}
 R(c,'#566',266,8,12,8);for(let k=0;k<4;k++)R(c,'#344',267,9+k*2,10,1);
 R(c,'#6b4a2a',392,63,8,14);R(c,'#a8733a',393,65,6,10);
 c.save();c.translate(0,DY);// salas de abajo, desplazadas si la planta abierta creció
 // aislamiento entre planta abierta y salas de abajo
 R(c,'#4b3f5e',8,186,384,2);
 // cocina
 R(c,'#e8e4dc',8,204,132,32);for(let y=204;y<236;y+=8)for(let x=8;x<140;x+=8)if((x+y>>3)%2)R(c,'#2b2b33',x,y,8,8);
 wall(8,188,132,16,'#d7e3ea','#8aa4b0');R(c,'#6b5b78',140,188,6,48);
 R(c,'#0003',12,210,80,3);R(c,'#8a7a66',12,200,80,10);R(c,'#d8d0c0',12,196,80,5);R(c,'#fff6',12,196,80,1);
 R(c,'#34383f',22,188,10,9);R(c,'#a33',23,189,3,2);R(c,'#7ad0ff',26,191,4,2);// cafetera
 R(c,'#9aa',56,198,12,2);R(c,'#778',62,194,2,5);// grifo
 R(c,'#0003',100,210,18,3);R(c,'#e8eef2',100,190,18,22);R(c,'#aab',100,200,18,1);R(c,'#778',115,194,1,4);R(c,'#778',115,204,1,5);
 R(c,'#6a5a7a',80,189,16,8);R(c,'#ccc',82,190,8,6);R(c,'#4f4',92,192,2,1);// microondas
 R(c,'#0003',60,230,34,3);R(c,'#a8733a',58,216,36,9);R(c,'#c58b4d',58,216,36,1);for(const x of[54,92]){R(c,'#c33',x,222,6,5);R(c,'#e55',x,222,6,1)}
 // calendario (la fecha se pinta dinámica)
 // sala de estar
 R(c,'#9c7449',146,204,154,32);for(let i=146;i<300;i+=7)R(c,'#8f6a41',i,204,1,32);
 wall(146,188,154,16,'#d6cdb9','#7a5a36');R(c,'#6b5b78',300,188,6,48);
 R(c,'#7b4a3a',190,210,86,24);R(c,'#e0a050',190,210,86,1);R(c,'#e0a050',190,233,86,1);R(c,'#e0a050',190,210,1,24);R(c,'#e0a050',275,210,1,24);for(let i=198;i<270;i+=8)R(c,'#9c5f48',i,216,4,4);
 R(c,'#0003',150,204,40,3);R(c,'#6b4a2a',150,186,40,18);R(c,'#4a321c',150,186,40,2);for(let r=0;r<2;r++)for(let i=0;i<19;i++){const hh=hash(i*7+r*13);R(c,['#d33','#35a','#3a5','#eb4','#a5d','#fff'][hh%6],152+i*2,190+r*7,1,5+hh%2)}R(c,'#4a321c',150,196,40,1);
 R(c,'#0003',203,205,38,2);R(c,'#111',202,190,40,14);R(c,'#333',202,190,40,1);tx(c,CFG.oficina.tv,222-(twid(CFG.oficina.tv)>>1),194,'#4fd1c5');
 {const k=CFG.oficina.carteles[0];if(k)poster(c,244,191,Math.max(28,twid(k.texto)+4),14,k.texto,k.fondo,k.color)}
 R(c,'#0003',198,230,54,3);R(c,'#8a2f3f',196,216,58,13);R(c,'#a8444f',196,216,58,3);R(c,'#8a2f3f',192,218,5,11);R(c,'#8a2f3f',253,218,5,11);R(c,'#5a1f2a',196,228,58,1);// sofá
 R(c,'#6b4a2a',214,230,22,5);R(c,'#8a5a2a',214,230,22,1);
 R(c,'#444',266,204,2,26);R(c,'#ffd98a',262,200,10,5);R(c,'#0003',262,230,10,2);// lámpara de pie
 // zona de impresión/archivo
 R(c,'#b9b3a8',306,204,86,32);for(let y=204;y<236;y+=8)for(let x=306;x<392;x+=8)if((x+y>>3)%2)R(c,'#afa99d',x,y,8,8);
 wall(306,188,86,16,'#cfc7b8','#7a6a56');
 {const k=CFG.oficina.carteles[1];if(k)poster(c,310,191,Math.max(28,twid(k.texto)+4),14,k.texto,k.fondo,k.color)}{const k=CFG.oficina.carteles[2];if(k)poster(c,346,191,Math.max(34,twid(k.texto)+4),14,k.texto,k.fondo,k.color)}
 R(c,'#0003',312,226,36,3);R(c,'#8a7a66',310,214,38,12);R(c,'#a8947a',310,212,38,3);
 R(c,'#e8e8ee',314,203,22,10);R(c,'#aab',314,203,22,2);R(c,'#556',316,209,18,2);// impresora
 R(c,'#0003',352,226,16,3);R(c,'#8a8a96',352,198,16,28);for(let k=0;k<3;k++)R(c,'#6a6a76',354,202+k*8,12,5);// archivador
 planta(c,376,214);planta(c,288,214);
 // esquinas
 for(const x of[AX[0]-4,AX[1]-4,AX[2]-4])planta(c,x,166);
 planta(c,12,194);
 c.restore();
}
// ===== Hora, clima, iluminación =====
function nivel(h){const n=.6;if(h<5)return n;if(h<7)return n*(7-h)/2;if(h<17.5)return 0;if(h<19.5)return n*(h-17.5)/2;return n}
const lerpc=(a,b,u)=>{const p=s=>[1,3,5].map(i=>parseInt(s.slice(i,i+2),16));const A=p(a),Bb=p(b);return '#'+A.map((v,i)=>Math.round(v+(Bb[i]-v)*u).toString(16).padStart(2,'0')).join('')};
function clima(){const q=Q.get('w');if(q)return q;const k=hash(Math.floor(Date.now()/1800000)+new Date().getDate())%7;return k===0?'lluvia':k===1?'nublado':'despejado'}
function cielo(day,cl){let t=lerpc('#0b0d2c','#6ec3ff',day),b=lerpc('#1b2260','#bfe6ff',day);const w=4*day*(1-day)*.55;t=lerpc(t,'#ff9a5a',w);b=lerpc(b,'#ffb36a',w);
 if(cl!=='despejado'){const g=lerpc('#2a2f40','#8a93a3',day);t=lerpc(t,g,cl==='lluvia'?.8:.55);b=lerpc(b,g,cl==='lluvia'?.8:.55)}return[t,b]}
function ventana(c,x,y,w,h,t,hh,day,sky,cl,vert){R(c,'#f2ead8',x-1,y-1,w+2,h+2);c.save();c.beginPath();c.rect(x,y,w,h);c.clip();// nubes y lluvia solo se ven por la ventana
 const n=6;for(let k=0;k<n;k++)R(c,lerpc(sky[0],sky[1],k/(n-1)),x,y+(k*h/n|0),w,Math.ceil(h/n));
 if(day<.55)for(let k=0;k<4;k++){const hh2=hash(x*13+y+k);if(hh2%2||vert)R(c,`rgba(255,255,230,${.4+.5*Math.abs(Math.sin(t/900+k))})`,x+hh2%w,y+(hh2>>3)%(h-2),1,1)}
 const u=hh>=6&&hh<=18?(hh-6)/12:null,um=((hh-18+24)%24)/12;
 if(u!==null&&cl!=='lluvia')R(c,'#ffe066',x+u*(w-3),y+(1-Math.sin(u*Math.PI))*(h-4)*.7+1,3,3);
 else if(u===null&&um<=1&&cl!=='lluvia')R(c,'#f4ecc8',x+um*(w-3),y+(1-Math.sin(um*Math.PI))*(h-4)*.7+1,3,3);
 if(cl!=='despejado'||hash(x+y)%3===0){const cx=((t/(RM?1e9:900)+x*3)%(w+10))-8;R(c,cl==='lluvia'?'#7a8494':'#ffffffcc',x+cx,y+h*.45,7,2);R(c,cl==='lluvia'?'#6a7484':'#ffffffcc',x+cx+2,y+h*.45-1,4,1)}
 if(cl==='lluvia')for(let k=0;k<5;k++){const p=RM?k/5:(t/300+k*.37)%1;R(c,'#cfe3ff',x+(k*5+p*3)%w,y+p*(h-2),1,2)}
 c.restore();
 if(!vert){R(c,'#f2ead8',x+(w>>1),y,1,h);R(c,'#f2ead8',x,y+(h>>1),w,1)}R(c,'#c9bfa6',x-2,y+h+1,w+4,1)}
// ===== Estaciones =====
const st=new Map(),seen=new Map(),slots=new Map(),nameMap=new Map();let feedAll=[],sel=null,sceneDirty=true;
const seatOcc=new Map();// 'zona:i' → {name,live,id}
// Zona: la del roster si la trae; si no, la primera cuyo patrón coincida con nombre+carpeta; si no, la primera sin patrón.
const grupo=a=>{if(Number.isInteger(a.zona))return a.zona;const n=(a.nombre+' '+a.carpeta).toLowerCase();for(let i=0;i<3;i++)if(ZP[i]&&ZP[i].test(n))return i;const d=ZP.findIndex(p=>!p);return d<0?1:d};
function kindOf(a){const n=(a.nombre+' '+a.carpeta).toLowerCase();return a.tipo==='codex'?'graph':a.tipo==='temp'?'code':/video|marca|design|diseñ/.test(n)?'swatch':/backend|api|server/.test(n)?'term':'code'}
function mon(c,x,y,kind,t,busy,seed,off){R(c,'#10122a',x,y,10,8);R(c,'#2a2f66',x,y,10,1);R(c,'#2a2f66',x,y+7,10,1);R(c,'#2a2f66',x,y,1,8);R(c,'#2a2f66',x+9,y,1,8);R(c,'#2a2f66',x+4,y+8,2,1);
 if(off){R(c,'#050610',x+1,y+1,8,6);R(c,'#f33',x+8,y+7,1,1);return}
 const k=busy&&!RM?Math.floor(t/220):0;
 if(busy)R(c,'#7be08a22',x-1,y-1,12,10);
 if(kind==='term'){R(c,'#06130a',x+1,y+1,8,6);for(let j=0;j<4;j++)R(c,busy?'#3ddc84':'#1f6b45',x+2,y+2+j,2+((seed>>j)+j+(busy?k*(j%2+1):0))%5,1);if(busy&&Math.floor(t/400)%2)R(c,'#fff',x+2,y+6,2,1)}
 else if(kind==='swatch'){R(c,'#1a1a28',x+1,y+1,8,6);const cs=['#ff6b9d','#ffd24d','#4fd1c5','#a98bff','#7be08a','#5aa9ff'];for(let j=0;j<4;j++)R(c,cs[(j+(busy?k:0)+seed)%6],x+2+(j%2)*3,y+2+(j>>1)*3,2,2);if(busy&&Math.floor(t/400)%2)R(c,'#fff',x+7,y+5,1,1)}
 else if(kind==='graph'){R(c,'#0a1020',x+1,y+1,8,6);for(let j=0;j<5;j++){const hh=1+Math.round(2.5+2.4*Math.sin((busy?t/300:0)+j*1.3+seed));R(c,j%2?'#4fd1c5':'#ffd24d',x+2+j*1.4|0,y+6-hh,1,hh)}}
 else{for(let j=0;j<5;j++){const L=3+((seed>>j)+j+(busy?k*(j%2+1):0))%5;R(c,busy?(j%2?'#7be08a':'#5aa9ff'):'#3d4380',x+1,y+1+j,L,1)}if(busy&&Math.floor(t/400)%2)R(c,'#fff',x+4+(k%4),y+5,1,1)}}
// El sprite vive en abeja.js (un solo módulo, para poder cambiar la mascota).
function body(c,x,y,col,t,P,seed,dx,o={}){(o.codex?hormiga:abeja)(c,x,y,col,t,P,seed,dx,{corona:o.hat?(CFG.director?.color||'#F2B33D'):null,temp:o.temp,pack:o.pack},RM)}
function idlePose(t,seed){const c=((t/1000)+seed)%18;return c<1.2?'stretch':(c>7&&c<10)?'sip':(c>12&&c<16)?'sleep':'idle'}
const SEEDC=['#ffe66b','#ff9db0','#9de0ff'];
function seat(c,ax,ay,a,t,mode,p,dirv){const seed=a?hash(a.id)%97:ax;const kind=a?kindOf(a):'code';
 const folding=p===99;// contratistas: mesas plegables
 R(c,'#0003',ax,ay+18,28,2);
 if(dirv){R(c,'#8a5a2a',ax+2,ay+14,28,4);R(c,'#c58b3d',ax+2,ay+14,28,1);R(c,'#ffd98a',ax+14,ay+15,4,2);R(c,'#10122a',ax+4,ay+10,5,4);R(c,'#2a2f66',ax+4,ay+10,5,1);R(c,mode==='sit'?'#7be08a':'#3d4380',ax+5,ay+12,3,1);mon(c,ax+19,ay+5,'code',t,mode==='sit',seed,false)}
 else{R(c,folding?'#d8d0b8':'#3a2f5c',ax,ay+14,28,4);R(c,folding?'#efe8d4':'#5a4a8c',ax,ay+14,28,1);if(folding){R(c,'#777',ax+2,ay+18,1,3);R(c,'#777',ax+25,ay+18,1,3)}
  R(c,'#444',ax,ay+10,1,4);R(c,'#ffd98a',ax,ay+9,3,1);// lámpara
  mon(c,ax+17,ay+5,kind,t,mode==='sit'&&a.busy,seed,mode!=='sit');
  R(c,SEEDC[seed%3],ax+16,ay+4,2,2);
  if(!folding){const k=hash(ax*31+ay)%5;// un objeto distinto por escritorio
   if(k===0){R(c,'#f2ead8',ax+4,ay+11,3,3);R(c,'#7a4a2a',ax+4,ay+11,3,1)}
   else if(k===1){R(c,'#5aa9ff',ax+3,ay+12,5,1);R(c,'#ffd24d',ax+3,ay+11,5,1);R(c,'#7be08a',ax+4,ay+10,4,1)}
   else if(k===2){R(c,'#b5651d',ax+4,ay+12,3,2);R(c,'#4caf50',ax+5,ay+9,1,3);R(c,'#4caf50',ax+4,ay+10,1,1);R(c,'#4caf50',ax+6,ay+10,1,1)}
   else if(k===3){R(c,'#222',ax+3,ay+11,1,3);R(c,'#222',ax+7,ay+11,1,3);R(c,'#222',ax+3,ay+10,5,1)}}
  if(a&&mode!=='empty'){R(c,'#1b1530',ax+9,ay+15,10,2);R(c,a.color||'#888',ax+10,ay+15,8,1)}}// placa con su color
 if(mode==='away'||mode==='absent'||mode==='empty'){const out=mode==='away'?3:0;R(c,'#2a2a3a',ax+4,ay+5+out*2,10,6);R(c,'#3c3c50',ax+4,ay+5+out*2,10,1)}
 if(mode==='sit'){const bx=ax+2,by=ay+5+(a.busy&&!RM?-(Math.floor(t/180)%2):0);body(c,bx,by,a.color,t,(a.dir&&PEND)?'stretch':a.busy?'type':idlePose(t,seed),seed,0,{hat:a.dir,temp:a.tipo==='temp',codex:a.tipo==='codex'});
  if(!a.busy){R(c,'#f2ead8',ax,ay+12,2,2);R(c,'#7a4a2a',ax,ay+12,2,1);if(!RM){const u=(t/900)%1;R(c,`rgba(255,255,255,${.7-u*.6})`,ax+(u>.5?1:0),ay+11-u*4,1,1)}}
  if(a.busy){R(c,'#0009',bx+1,by-10,12,3);R(c,'#7be08a',bx+2,by-9,RM?6:((t/60+seed*7)%11)|0,1);
   if(!RM){const u=((t/2400+seed/97)%1);if(u<.55){R(c,'#fff',ax+15+u*12,ay+2-Math.sin(u*Math.PI*1.8)*7,2,2)}}}}
 if(mode!=='sit')R(c,'#1e1834'+(mode==='away'?'40':'66'),ax,ay+4,28,16)}
function rack(c,j,a,t){const[x,y]=RACK(j);const busy=a&&a.busy;
 if(a){const k=busy&&!RM?Math.floor(t/130):0;for(let r=0;r<7;r++){R(c,((hash(a.id)+r*3+k*(r%3+1))%5<(busy?3:1))?(r%2?'#7be08a':'#ffd24d'):'#2a3a2a',x+2,y+4+r*5,2,1);R(c,'#334',x+5,y+4+r*5,9,1)}
  mon(c,x+3,y-1+0,'graph',t,busy,hash(a.id)%97,false);hormiga(c,x+1,y+24,a.color,t,busy?'type':'idle',hash(a.id)%97,0,{},RM)}
 else for(let r=0;r<7;r++)R(c,'#1c2230',x+2,y+4+r*5,2,1);
 if(!a)R(c,'#1e183440',x,y,16,36)}
// ===== Movimiento =====
const zonaDe=p=>p.y<66?'t':p.y<76?'ct':p.y<180+DY?'o':p.y<186+DY?'cb':'b';
const ax=x=>AX.reduce((b,v)=>Math.abs(v-x-14)<Math.abs(b-x-14)?v:b,AX[0]);
const doorOf=x=>x<131?DOORX.m:x<250?DOORX.d:DOORX.s;
function route(P,T){const L=[[P.x,P.y]];const push=(x,y)=>{const l=L[L.length-1];if(l[0]!==x||l[1]!==y)L.push([x,y])};
 const zp=zonaDe(P),zt=zonaDe(T);let cc;
 if(zp==='o'){const a=ax(P.x);push(a,P.y);cc=zt==='b'||zt==='cb'?corrB:corrT;push(a,cc)}
 else if(zp==='t'){const d=doorOf(P.x);push(d,P.y);push(d,corrT);cc=corrT}
 else if(zp==='b'){push(P.x,corrB);cc=corrB}
 else{cc=zp==='ct'?corrT:corrB;push(P.x,cc)}
 const lx=()=>L[L.length-1][0];
 if(zt==='t'){if(cc===corrB){const a=ax(lx());push(a,corrB);push(a,corrT);cc=corrT}const d=doorOf(T.x);push(d,corrT);push(d,T.y);push(T.x,T.y)}
 else if(zt==='b'||zt==='cb'){if(cc===corrT){const a=ax(lx());push(a,corrT);push(a,corrB);cc=corrB}push(T.x,corrB);push(T.x,T.y)}
 else if(zt==='ct'||zt==='cb'){push(T.x,T.y)}
 else{const a=ax(T.x);push(a,cc);push(a,T.y);push(T.x,T.y)}
 L.shift();return L}
let meet=null,PEND=0,pqKey='';
const MEET=[[44,18],[70,18]],DIRV=[190,46],EXIT=[372,66],ENTRY={x:372,y:66};let CAFE=[[24,205],[50,205],[76,205]];
function goalFor(s,now){const a=s.a;
 if(s.leaving)return{k:'exit',T:EXIT};
 if(a.tipo==='temp')return{k:'seat',T:s.home};
 if(a.dir||a.tipo==='codex')return{k:'seat',T:s.home};
 if(meet&&meet.A&&(meet.A===s||meet.B===s)){const g=meet.A.a.dir||(meet.B&&meet.B.a.dir);if(g)return{k:'dir',T:DIRV};return{k:'meet',T:MEET[s===meet.A?0:1]}}
 if(!a.busy&&now-(seen.get(a.id)?.desde||now)>40000&&((Math.floor(now/40000)+hash(a.id))%4===0))return{k:'cafe',T:CAFE[hash(a.id)%3]};
 return{k:'seat',T:s.home}}
function mover(s,dt,now){if(s.fuera)return;const g=goalFor(s,now),key=g.k+g.T[0]+','+g.T[1]+(s.leaving?'x':'');
 if(s.key!==key){s.key=key;const T={x:g.T[0],y:g.T[1]};if(RM||Math.hypot(s.px-T.x,s.py-T.y)<1){s.px=T.x;s.py=T.y;s.path=[]}else s.path=route({x:s.px,y:s.py},T)}
 let sp=(s.prisa?110:38)*dt;/* ponytail: llamado o despedido camina rápido */while(s.path.length&&sp>0){const n=s.path[0],dx=n[0]-s.px,dy=n[1]-s.py,d=Math.hypot(dx,dy);if(d<=sp){s.px=n[0];s.py=n[1];s.path.shift();sp-=d}else{s.px+=dx/d*sp;s.py+=dy/d*sp;s.dx=dx;sp=0}}
 s.walk=s.path.length>0;s.at=g.k;if(!s.walk)s.prisa=false;
 if(s.leaving&&!s.walk){if(s.a.roster||s.a.dir){s.leaving=false;s.fuera=true;s.px=s.home[0];s.py=s.home[1];s.key=''}else{s.el.remove();st.delete(s.a.id)}}}
// ===== Dibujo del frame =====
const cat={x:230,y:222,tx:230,ty:222,w:0,sleep:0},dust=Array.from({length:26},(_,i)=>({x:10+hash(i*5)%80,y:80+hash(i*7)%90,v:.5+hash(i)%5/10}));
const BUB=['☕','💭','🎵','📚','😴','💡'];
function frame(t,dt){const h=horaAhora(),cl=clima(),L=clamp(nivel(h)+(cl==='lluvia'?.1:cl==='nublado'?.04:0),0,.65),day=clamp(1-nivel(h)/.6,0,1),sky=cielo(day,cl);
 X.globalCompositeOperation='source-over';X.drawImage(bg,0,0);
 // ventanas
 for(const[x,y,w,hh]of WINS)ventana(X,x,y>=186?y+DY:y,w,hh,t,h,day,sky,cl,x<8);
 // parches de luz del sol sobre el suelo
 if(day>.35&&cl!=='lluvia'){const a=(cl==='nublado'?.05:.12)*day,u=clamp((h-6)/12,0,1),dy=(u-.5)*70,len=60+80*Math.sin(u*Math.PI);
  for(const wy of[86,116,146]){X.fillStyle=`rgba(255,243,176,${a})`;X.beginPath();X.moveTo(8,wy);X.lineTo(8+len,wy+dy);X.lineTo(8+len,wy+dy+14);X.lineTo(8,wy+16);X.fill()}
  if(!RM)for(const d of dust){d.x+=d.v*dt*4;d.y+=Math.sin(t/900+d.x)*.05;if(d.x>8+len)d.x=10;R(X,'#fff7d0b0',d.x,clamp(d.y,80,170),1,1)}}
 // calendario, reloj, pantallas de Dirección
 const now=new Date(),dn=now.getDate()+'',mes=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][now.getMonth()];
 X.save();X.translate(0,DY);R(X,'#fff',74,189,13,13);R(X,'#d33',74,189,13,4);tx(X,mes,75,190,'#fff');tx(X,dn,80-((twid(dn)-3)>>1)+1-(dn.length>1?2:0),196,'#26304a');X.restore();
 const cx=200,cy=14;R(X,'#fff',cx-5,cy-5,10,10);R(X,'#6b4a2a',cx-5,cy-5,10,1);R(X,'#6b4a2a',cx-5,cy+4,10,1);R(X,'#6b4a2a',cx-5,cy-5,1,10);R(X,'#6b4a2a',cx+4,cy-5,1,10);
 const ln=(an,l,col)=>{for(let k=0;k<=l;k++)R(X,col,cx+Math.round(Math.sin(an)*k),cy+Math.round(-Math.cos(an)*k),1,1)};
 ln((now.getHours()%12+now.getMinutes()/60)/12*6.283,2,'#26304a');ln(now.getMinutes()/60*6.283,3,'#26304a');
 let nb=0,ni=0;for(const s of st.values())if(s.a.tipo==='claude'&&!s.fuera){s.a.busy?nb++:ni++}
 const scr=(x,n,col,tt)=>{R(X,'#10122a',x,9,18,11);R(X,'#2a2f66',x,9,18,1);R(X,col,x+2,11,3,3);tx(X,String(n),x+7,11,col);R(X,'#3d4380',x+2,16,14,1);R(X,col,x+2,16,Math.min(14,n*3),1);tx(X,tt,x+2,17,'#9aa0d0')};
 R(X,'#10122a',171,8,20,13);R(X,'#10122a',209,8,20,13);scr(172,nb,'#7be08a','');scr(210,ni,'#5aa9ff','');
 tx(X,'WORK',173,15,'#7be08a');tx(X,'IDLE',211,15,'#5aa9ff');
 // vapor de la cafetera, papel de impresora
 X.save();X.translate(0,DY);if(!RM)for(let k=0;k<3;k++){const u=(t/1100+k/3)%1;R(X,`rgba(255,255,255,${.6-u*.55})`,26+Math.sin(u*6+k)*2,187-u*8,1,1)}
 const pc=(t/1000)%60;if(pc<6&&!RM){R(X,'#fff',317,211+Math.min(4,pc*2),14,Math.min(5,pc*2));R(X,'#cdd',320,213+Math.min(4,pc*2),8,1)}X.restore();
 // racks (Codex) y escritorios
 const rk=[...st.values()].filter(s=>s.a.tipo==='codex'&&s.a.bucle&&!s.a.roster);
 for(let j=0;j<4;j++)rack(X,j,rk[j]?.a||null,t);
 for(let p=0;p<LAY.nz;p++)for(let i=0;i<capZ(p);i++){const o=seatOcc.get(p+':'+i),[sx,sy]=seatXY(p,i);let s=o&&o.live?st.get(o.id):null;
  if(s)seat(X,sx,sy,s.a,t,s.fuera?'absent':(!s.walk&&s.at==='seat')?'sit':'away',p,false);
  else seat(X,sx,sy,o?{id:o.name,busy:false,color:'#888',tipo:'x',nombre:o.name,carpeta:''}:null,t,o?'absent':'empty',p,false)}
 for(let i=0;i<capC();i++){const[sx,sy]=seatC(i),s=[...st.values()].find(q=>(q.a.tipo==='temp'||q.a.tipo==='codex'&&!q.a.roster&&!q.a.bucle)&&q.tslot===i&&!q.leaving&&!q.walk&&q.at==='seat');seat(X,sx,sy,s?s.a:null,t,s?'sit':'empty',99,false)}
 const gs=[...st.values()].find(s=>s.a.dir);
 if(CFG.director)seat(X,GEN[0],GEN[1],gs?gs.a:null,t,gs&&!gs.walk&&!gs.fuera?'sit':'empty',-1,true);
 if(PEND){const p=RM?1:.5+.5*Math.sin(t/260);R(X,'#8a5a00',GEN[0]+15,GEN[1]-11,13,11);R(X,p>.5?'#ffd24d':'#f0a020',GEN[0]+16,GEN[1]-10,11,9);tx(X,'?',GEN[0]+20,GEN[1]-8,'#3a2f10');R(X,'#8a5a00',GEN[0]+21,GEN[1],1,3)}
 // línea de contratación
 {X.setLineDash([2,2]);X.strokeStyle='rgba(255,157,77,.45)';X.lineWidth=1;for(const s of st.values()){if(s.a.tipo!=='temp')continue;const pd=[...st.values()].find(q=>q.a.tipo!=='temp'&&(q.a.nombre===s.a.padre||q.a.raw===s.a.padre))||gs;if(!pd||![s.a.id,pd.a.id].some(i=>i===HOV||i===sel))continue;// la línea solo se ve al señalar al temporal o a quien lo contrató
  X.beginPath();X.moveTo(s.px+14,s.py+8);X.lineTo(pd.px+14,pd.py+8);X.stroke()}X.setLineDash([])}
 // caminantes y fuera de su escritorio
 const wl=[...st.values()].filter(s=>(s.walk||s.at!=='seat')&&!s.fuera&&(!s.a.dir||s.walk)&&!(s.a.tipo==='codex'&&s.a.bucle)).sort((a,b)=>a.py-b.py);
 for(const s of wl){if(s.wait>now.getTime())continue;const a=s.a,seed=hash(a.id)%97,pose=s.walk?'walk':s.at==='cafe'?'sip':'idle';const bob=(!RM&&s.walk&&Math.floor(t/130)%2)?-1:(!RM&&!s.walk&&s.at!=='cafe'&&Math.floor(t/350)%2)?-1:0;
  body(X,s.px+2,s.py+5+bob,a.color,t,pose,seed,s.dx,{temp:a.tipo==='temp',pack:a.tipo==='temp',codex:a.tipo==='codex'})}
 // gato (en la sala de estar, desplazada DY)
 X.save();X.translate(0,DY);
 if(!RM){cat.w-=dt;if(cat.sleep>0)cat.sleep-=dt;else if(Math.hypot(cat.tx-cat.x,cat.ty-cat.y)<1){if(cat.w<=0){cat.w=4+Math.random()*6;if(Math.random()<.3){cat.tx=225;cat.ty=212;cat.sleep=18}else{cat.tx=160+Math.random()*225;cat.ty=208+Math.random()*20}}}else{const d=Math.hypot(cat.tx-cat.x,cat.ty-cat.y);cat.x+=(cat.tx-cat.x)/d*14*dt;cat.y+=(cat.ty-cat.y)/d*14*dt;cat.f=cat.tx>cat.x?1:-1}}
 {const f=cat.f||1,sl=cat.sleep>0&&Math.hypot(cat.tx-cat.x,cat.ty-cat.y)<2;R(X,'#0003',cat.x,cat.y+5,9,1);R(X,'#e0903a',cat.x,cat.y+(sl?3:1),8,sl?3:4);R(X,'#e0903a',cat.x+(f>0?6:-1),cat.y+(sl?2:-1),3,3);R(X,'#c0702a',cat.x+(f>0?6:0),cat.y+(sl?1:-2),1,1);R(X,'#c0702a',cat.x+(f>0?8:1),cat.y+(sl?1:-2),1,1);
  if(!sl){const tw=Math.sin(t/200)>0?0:1;R(X,'#e0903a',cat.x+(f>0?-2:8),cat.y-1-tw,2,3)}else if(!RM&&Math.floor(t/900)%2) tx(X,'Z',cat.x+4,cat.y-6,'#fff')}
 X.restore();
 placas();
 // iluminación nocturna
 if(L>.02){D.globalCompositeOperation='source-over';D.clearRect(0,0,W,H);D.fillStyle=`rgba(12,16,58,${L})`;D.fillRect(0,0,W,H);D.globalCompositeOperation='destination-out';
  const lt=[];const rm=[[68,44,90,.6],[200,40,70,.6],[326,40,70,.35],[140,44,22,.5],[60,128,70,.45],[156,128,70,.45],[252,128,70,.45],[345,128,80,.45],[60,71,50,.4],[180,71,50,.4],[300,71,50,.4],[70,218,60,.55],[225,218,70,.5],[345,218,60,.5]];
  for(const[x,y,r,a]of rm)lt.push([x,y>=186?y+DY:y,r,a]);
  for(let p=0;p<LAY.nz;p++)for(let i=0;i<capZ(p);i++){const[sx,sy]=seatXY(p,i);lt.push([sx+1,sy+10,16,.5]);const o=seatOcc.get(p+':'+i),s=o&&o.live?st.get(o.id):null;if(s&&s.a.busy&&!s.walk)lt.push([sx+22,sy+9,11,.7])}
  for(let i=0;i<capC();i++){const[sx,sy]=seatC(i);lt.push([sx+1,sy+10,16,.4])}
  lt.push([GEN[0]+2,GEN[1]+12,18,.6],[267,206+DY,16,.7],[27,192+DY,14,.6],[222,196+DY,24,.55],[323,206+DY,14,.4]);for(let j=0;j<4;j++)lt.push([RACK(j)[0]+8,RACK(j)[1]+18,14,.35]);
  for(const[x,y,r,a]of lt){const g=D.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(0,0,0,${a})`);g.addColorStop(1,'rgba(0,0,0,0)');D.fillStyle=g;D.fillRect(x-r,y-r,r*2,r*2)}
  X.drawImage(dk,0,0);
  X.globalCompositeOperation='lighter';const wm=L/.65*.22;for(const[x,y,r]of[[GEN[0]+2,GEN[1]+12,22],[267,206,18],[27,192,16]]){const g=X.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(255,190,100,${wm})`);g.addColorStop(1,'rgba(255,190,100,0)');X.fillStyle=g;X.fillRect(x-r,y-r,r*2,r*2)}
  X.globalCompositeOperation='source-over'}
 // posiciones del overlay
 for(const s of st.values()){const w=s.bw,hh=s.bh,l=(s.a.tipo==='codex'?s.px:s.px)/W*100,tp=s.py/H*100;
  if(s.l!==l||s.tp!==tp){s.l=l;s.tp=tp;s.el.style.left=l+'%';s.el.style.top=tp+'%'}
  s.el.style.visibility=s.wait>now.getTime()?'hidden':'';
  const tt=chipTxt(s);if(tt!==s.ctx){s.ctx=tt;s.ss.textContent=tt}
  if(!RM&&!s.a.busy&&s.a.tipo==='claude'&&!s.fuera&&!s.bub&&!s.walk&&now.getTime()>s.nextEmoji){habla(s,BUB[Math.floor(Math.random()*BUB.length)],2400);s.nextEmoji=now.getTime()+20000+Math.random()*25000}}
 if(!RM&&!document.hidden)for(const s of st.values())if(!(s.wait>now.getTime()))mover(s,dt,now.getTime());
 choques(now.getTime());
 $('reloj').textContent=hms(now)+' · '+(cl==='lluvia'?'🌧':cl==='nublado'?'☁':day>.3?'☀':'🌙')}
// Placas de las salas: fondo oscuro y texto claro, en lugares sin muebles; nunca las tapa nada.
function placa(txt,cx,y){const w=twid(txt)+4,x=Math.round(cx-w/2);R(X,'#1b1530e0',x,y,w,7);R(X,'#ffffff30',x,y,w,1);tx(X,txt,x+2,y+1,'#f2ead8')}
function placas(){if(CFG.director)placa(T('sala_dir'),230,56);placa(T('sala_reun'),68,57);placa(T('sala_serv'),326,57);placa(T('sala_entrada'),359,81);
 placa(T('sala_cocina'),118,228+DY);placa(T('sala_estar'),174,207+DY);placa(T('sala_imp'),330,229+DY)}
// Choques entre etiquetas: cada ~0,4 s, las de más prioridad quedan en su sitio y las demás se corren hacia abajo;
// si no caben, se esconde el estado (no el nombre).
let ultChoque=0;
function choques(now){if(now-ultChoque<400)return;ultChoque=now;const z=movil()?1:zoom;
 const pri=s=>(s.a.dir?4:s.a.roster&&!s.fuera?3:s.a.roster?2:s.a.tipo==='temp'?0:1)+(s.a.id===sel?5:0);
 const puestos=[];for(const s of[...st.values()].filter(s=>s.el.style.visibility!=='hidden').sort((a,b)=>pri(b)-pri(a))){
  s.el.style.setProperty('--dy','0px');s.ss.style.visibility='';const r1=s.n.getBoundingClientRect(),r2=s.ss.getBoundingClientRect();
  const l=Math.min(r1.left,r2.left),r=Math.max(r1.right,r2.right),t=r1.top,b=r2.bottom;let dy=0;
  for(let k=0;k<4;k++){const c=puestos.find(p=>!(r<=p.l||l>=p.r||b+dy<=p.t||t+dy>=p.b));if(!c)break;dy=c.b-t+1}
  if(dy>40){s.ss.style.visibility='hidden';dy=0}s.el.style.setProperty('--dy',dy/z+'px');puestos.push({l,r,t:t+dy,b:b+dy})}}
function chipTxt(s){const a=s.a,D=CFG.director?.nombre||'';
 if(s.fuera)return T(a.dir?'chip_sin_sesion':'chip_fuera');if(s.leaving&&(a.roster||a.dir))return T('chip_saliendo');
 if(a.dir&&(a.estadoWeb==='esperando'||a.estadoWeb==='trabajando')&&!s.walk)return (a.busy?'⌨ ':'☕ ')+T('en_web');
 if((a.roster||a.dir)&&a.estadoWeb==='terminal'&&!s.walk)return T('chip_terminal',{i:a.busy?'⌨':'☕'});if(a.tipo==='temp')return s.leaving||a.estado==='saliendo'?T('chip_recogiendo'):T('chip_temporal')+(a.padre?T('chip_de',{n:a.padreN}):'');
 if(a.tipo==='codex')return a.busy?'⚙ '+(a.vuelta||T('estado_trabajando')):T('chip_pausa');
 if(s.walk)return T('chip_yendo',{a:{meet:T('yendo_meet'),dir:T('yendo_dir',{n:D}),cafe:T('yendo_cafe'),seat:T('yendo_seat')}[s.at]||''});
 if(s.at==='cafe')return T('chip_cocina');if(s.at==='meet')return T('chip_reunion');if(s.at==='dir')return T('chip_con_dir',{n:D});
 return T(a.busy?'chip_trabajando':'chip_esperando')}
let last=0;function loop(t){const dt=Math.min(.1,(t-last)/1000||0);last=t;if(!document.hidden)frame(t,dt);if(!RM)requestAnimationFrame(loop)}
document.addEventListener('visibilitychange',()=>{last=performance.now()});
// ===== Datos =====
const vivo=r=>!['detenido','cerrada','terminado'].includes(r.estado);
function norm(r){const dir=!!r.directora;return{id:r.id,tipo:r.tipo,dir,busy:r.estado!=='idle',estado:r.estado,nombre:dir?(CFG.director?.nombre||r.nombre):r.nombre,
 sesionId:r.sesionId||r.sessionId,bucle:!!r.bucle,modelo:r.modelo,carpeta:r.cwd||r.detalle||'',raw:r.nombre,pedido:r.pedido||'',vuelta:r.vuelta,desde:r.desde||0,upd:r.updatedAt||0,color:dir?(CFG.director?.color||'#F2B33D'):PAL[hash(r.nombre||r.id)%PAL.length]}}
function normT(t){return{id:'t-'+t.id,tipo:'temp',dir:false,busy:t.estado!=='saliendo',estado:t.estado,nombre:((t.tarea||t.tipo||'ayudante').split(/\s+/).slice(0,3).join(' ')).slice(0,22),carpeta:'',raw:t.id,pedido:'',
 tarea:t.tarea||'',modelo:t.modelo||'',padre:t.padre||'',padreN:t.padreN||t.padre||'',desde:Date.now()-(t.hace||0)*1000,upd:0,color:'#aeb9c9'}}
function agrupar(raw){const vivos=new Map(),term=[],hist=new Map();
 for(const r of raw){const a=norm(r);
  if(a.tipo==='codex'){if(vivo(r))vivos.set(a.id,a);else term.push({...a,ok:r.estado==='terminado'});continue}
  if(vivo(r)){const p=vivos.get(a.nombre);if(!p||a.upd>p.upd)vivos.set(a.nombre,a)}
  else{const p=hist.get(a.nombre);if(!p||a.upd>p.upd)hist.set(a.nombre,a)}}
 for(const n of hist.keys())if(vivos.has(n))hist.delete(n);
 return{vivos:[...vivos.values()],term,hist:[...hist.values()].sort((a,b)=>b.upd-a.upd)}}
function estTxt(a){if(a.fuera)return T(a.dir?'est_sin_sesion':'est_fuera');if(a.estadoWeb==='terminal')return T('estado_terminal');if(a.dir&&a.estadoWeb&&a.estadoWeb!=='libre')return T('en_web');return a.tipo==='temp'?T(a.estado==='saliendo'?'est_saliendo':'est_temporal'):a.busy?(a.vuelta||T('estado_trabajando')):T('estado_esperando')}
const ov=$('ov');
function mk(a){const el=document.createElement('button');el.className='st';el.type='button';
 const n=document.createElement('span');n.className='nm';const e=document.createElement('span');e.className='ss';el.append(n,e);ov.appendChild(el);
 const s={el,n,ss:e,a,px:0,py:0,home:[0,0],path:[],key:'',bw:28,bh:20,nextEmoji:Date.now()+8000+Math.random()*20000,at:'seat'};
 el.onmouseenter=()=>{HOV=s.a.id;tip(s)};el.onfocus=()=>tip(s);el.onmousemove=ev=>mueve(ev);el.onmouseleave=el.onblur=()=>{HOV=null;$('tip').style.display='none'};
 el.onclick=e=>{if(!suppress)GH.abrir(s.a)};
 if(!a.dir){el.draggable=true;el.ondragstart=e=>{drag=null;e.stopPropagation();e.dataTransfer.setData('application/x-oficina',JSON.stringify({id:s.a.id}));e.dataTransfer.effectAllowed='move';document.body.classList.add('arrastrando')};el.ondragend=()=>{drag=null;document.body.classList.remove('arrastrando')}}
 if(a.roster||a.lanzable){const b=document.createElement('span');b.className='llamar';b.textContent=T('llamar');b.setAttribute('role','button');b.title=T('llamar_tt',{n:a.nombre});b.onclick=e=>{e.stopPropagation();GH.llamar(s.a.raw)};el.appendChild(b);s.ll=b}
 return s}
const eventosDe=a=>feedAll.filter(e=>e.n===a.nombre||e.n===a.raw||e.n===a.sesion);
const feedTxt=e=>e.tipo?T('feed_'+e.tipo,{n:e.n,v:e.v}):String(e.t||'');
function tip(s){const a=s.a,t=$('tip');t.textContent='';
 const add=(k,v)=>{const d=document.createElement('div');const sp=document.createElement('span');sp.className='k';sp.textContent=k+': ';d.append(sp,document.createTextNode(v));t.appendChild(d)};
 const b=document.createElement('b');b.textContent=a.nombre+(a.tipo==='temp'?T('temporal_paren'):'');t.appendChild(b);
 if(a.tipo==='temp'){add(T('tarea'),a.tarea||'—');add(T('modelo'),a.modelo||'—');add(T('contratado_por'),a.padreN||'—');add(T('estado'),estTxt(a));add(T('desde_hace'),dur(Date.now()-a.desde))}
 else{add(T('carpeta'),a.carpeta||'—');add(T('estado'),estTxt(a));add(T('desde_hace'),dur(Date.now()-(seen.get(a.id)?.desde||a.desde)));
  if(a.tipo==='codex'){add('CODEX',a.modelo||'Codex');if(a.vuelta)add(T('estado'),a.vuelta)}if(a.directores?.length>1)add(T('varias_dir',{n:a.directores.length}),a.directores.map(d=>d.nombre+' ('+d.donde+', '+d.estado+')').join('; '));if(a.pedido)add(T('ultimo_pedido'),a.pedido);if(a.roster||a.dir)add(T('clic'),a.dir&&!a.lanzable?T('clic_dir',{n:a.nombre}):a.fuera?T('clic_llamar'):T('clic_chat'));const ev=eventosDe(a)[0];add(T('ultima_novedad'),ev?ev.h+' '+feedTxt(ev):T('sin_novedades'))}
 t.style.display='block';const r=s.el.getBoundingClientRect();pos(r.left+r.width/2,r.bottom)}
function pos(x,y){const t=$('tip'),w=t.offsetWidth,h=t.offsetHeight;t.style.left=Math.max(6,Math.min(innerWidth-w-6,x-w/2))+'px';t.style.top=(y+h+30>innerHeight?Math.max(6,y-h-60):y+24)+'px'}
function mueve(ev){if($('tip').style.display==='block')pos(ev.clientX,ev.clientY+10)}
function habla(s,txt,ms=4200){if(!s)return;if(s.bub)s.bub.remove();const b=document.createElement('div');b.className='burb';b.textContent=txt;s.el.appendChild(b);s.bub=b;setTimeout(()=>{b.remove();if(s.bub===b)s.bub=null},ms)}
const FR={trabajando:'fr_trabajando',esperando:'fr_esperando',llego:'fr_llego',cerro:'fr_cerro',detuvo:'fr_cerro',termino:'fr_termino',vuelta:'fr_vuelta'};
function conversar(nuevos){const gen=[...st.values()].find(s=>s.a.dir&&!s.fuera);if(!gen)return;let i=0;
 for(const e of nuevos.slice(0,2)){const dest=[...st.values()].find(s=>!s.a.dir&&s.a.tipo!=='temp'&&(e.n===s.a.nombre||e.n===s.a.raw));
  const msg=T(FR[e.tipo]||'fr_def');
  setTimeout(()=>{if(dest){habla(gen,'→ '+dest.a.nombre+': '+msg);habla(dest,T('entendido',{n:gen.a.nombre}))}else if(e.n!==gen.a.nombre)habla(gen,feedTxt(e))},i++*2500)}}
// asientos deterministas
// Puestos: los del roster vienen fijos del servidor (config) y nunca se ceden. Las sesiones vivas fuera del roster
// toman el primer escritorio libre de su zona (y lo conservan mientras sigan vivas); la isla crece si hace falta.
function asignar(g,ros){const nz=ZON.length-1,usado=new Set(),maxI={};
 const marca=(p,i,o)=>{seatOcc.set(p+':'+i,o);usado.add(p+':'+i);maxI[p]=Math.max(maxI[p]??-1,i)};
 seatOcc.clear();
 for(const a of ros){const pu=a.puesto&&a.puesto.zona<nz?a.puesto:{zona:Math.min(grupo(a),nz-1),i:0};a._sl=[pu.zona,pu.i];marca(pu.zona,pu.i,{name:a.nombre,live:true,id:a.id})}
 const lv=g.vivos.filter(a=>a.tipo==='claude'&&!a.dir).sort((a,b)=>a.nombre<b.nombre?-1:1);
 for(const a of lv){let sl=slots.get('n:'+a.nombre);if(!sl||usado.has(sl[0]+':'+sl[1])||sl[0]>=nz){const z=Math.min(grupo(a),nz-1);let i=0;while(usado.has(z+':'+i))i++;sl=[z,i]}
  slots.set('n:'+a.nombre,sl);a._sl=sl;marca(sl[0],sl[1],{name:a.nombre,live:true,id:a.id})}
 return maxI}
const tslot=new Map();let primera=true,buzon=[],tempIds=new Set();
function aplicar(d,roster0){buzon=d.buzon_estado||[];if(d.generado)$('hora2').textContent=T('actualizado',{h:hms(new Date(d.generado))});
 const dr=roster0.find(r=>r.director),roster=roster0.filter(r=>!r.director);
 const g=agrupar(d.agentes||[]),rn=new Set(roster.map(r=>r.nombre)),info=new Map(g.vivos.map(a=>[a.nombre,a]));
 g.vivos=g.vivos.filter(a=>!rn.has(a.nombre));g.hist=g.hist.filter(a=>!rn.has(a.nombre));
 const ros=roster.map(r=>{const v=info.get(r.nombre)||{};return{id:'r-'+r.nombre,tipo:r.motor==='codex'?'codex':'claude',roster:true,dir:false,nombre:r.nombre,raw:r.nombre,zona:r.zona,puesto:r.puesto,carpeta:r.carpeta.split(/[\\/]/).pop(),color:r.color,
  estadoWeb:r.estado,estado:r.estado,fuera:r.estado==='libre',busy:r.estado==='trabajando'||(r.estado==='terminal'&&r.terminalEstado!=='idle'),pedido:v.pedido||'',desde:v.desde||0,upd:v.upd||0}});
 // El director: una sola entrada estable ("general"), con el estado que manda el servidor (web, terminal o fuera).
 const dv=g.vivos.find(a=>a.dir);g.vivos=g.vivos.filter(a=>!a.dir);
 if(dr)g.vivos.push({id:'general',tipo:'claude',dir:true,lanzable:!!dr.lanzable,estadoWeb:dr.estado,estado:dr.estado,fuera:dr.estado==='libre',busy:dr.estado==='trabajando'||(dr.estado==='terminal'&&dr.terminalEstado!=='idle'),
  nombre:dr.mostrar,raw:'_director',sesion:dv?.raw,directores:dr.directores,carpeta:(dr.carpeta||'').split(/[\\/]/).pop(),pedido:dv?.pedido||'',desde:dv?.desde||0,upd:dv?.upd||0,color:CFG.director?.color||'#F2B33D'});
 const maxI=asignar(g,ros);
 const temps=(d.temporales||[]).map(normT);
 usarLayout(calcLayout(ZON.length-1,maxI,temps.length+g.vivos.filter(a=>a.tipo==='codex'&&!a.bucle).length,true));
 const all=[...g.vivos,...ros,...temps],ids=new Set(all.map(a=>a.id));
 for(const k of[...tslot.keys()])if(!ids.has(k)&&!st.has(k))tslot.delete(k);
 for(const[id,s]of st)if(!ids.has(id)){if(s.a.tipo==='temp'){s.leaving=true;if(!s.walk&&!s.path.length)s.key=''}else{s.el.remove();st.delete(id);if(sel===id)sel=null}}
 let ti=0;const rkIds=g.vivos.filter(a=>a.tipo==='codex'&&a.bucle).map(a=>a.id).sort();
 for(const a of all){let s=st.get(a.id),nueva=false;if(!s){s=mk(a);st.set(a.id,s);nueva=true}
  const prev=seen.get(a.id);if(!prev||prev.estado!==a.estado)seen.set(a.id,{estado:a.estado,desde:a.desde||Date.now()});
  if(!primera&&!nueva&&a.pedido&&a.pedido!==s.a.pedido&&!a.dir)habla(s,'💬 '+a.pedido,6000);
  if(a.tipo==='temp'&&s.leaving&&a.estado!=='saliendo'){}
  if(a.roster||a.dir){if(nueva)s.fuera=!!a.fuera;
   else if(s.a.fuera&&!a.fuera){s.fuera=false;s.leaving=false;s.key='';if(!RM){s.px=ENTRY.x;s.py=ENTRY.y;s.prisa=true}}// llamado: entra caminando
   else if(!s.a.fuera&&a.fuera){if(RM)s.fuera=true;else{s.leaving=true;s.key='';s.prisa=true}}}// despedido: sale caminando
  s.a=a;if(a.tipo==='temp'&&a.estado==='saliendo')s.leaving=true;
  let home;
  if(a.dir){home=GEN;s.bw=32;s.bh=20}
  else if(a.tipo==='codex'&&a.bucle&&!a.roster){const j=Math.min(3,rkIds.indexOf(a.id));home=RACK(j);s.bw=16;s.bh=36}
  else if(a.tipo==='temp'||a.tipo==='codex'&&!a.roster){let sl=tslot.get(a.id);if(sl===undefined){const used=new Set(tslot.values());sl=0;while(used.has(sl))sl++;tslot.set(a.id,sl);s.wait=Date.now()+ti*2500}ti++;s.tslot=sl;home=seatC(sl);s.bw=28;s.bh=20}
  else{const sl=a._sl;home=seatXY(sl[0],sl[1]);s.bw=28;s.bh=20}
  s.home=home;if(s.fuera){s.px=home[0];s.py=home[1]}// fuera de la oficina no camina: si se mueve su escritorio, la etiqueta va directo
  if(nueva){const rawHome=home;if(a.tipo==='temp'&&!RM){s.px=ENTRY.x-ti*9;s.py=ENTRY.y}else{s.px=rawHome[0];s.py=rawHome[1]}}
  s.el.style.width=s.bw/W*100+'%';s.el.style.height=s.bh/H*100+'%';
  s.el.className='st '+(a.dir?'dir ':a.tipo==='temp'?'temp ':'')+(a.busy?'busy':'idle')+(a.fuera?' fuera':'')+(sel===a.id?' sel':'');
  let multi=s.el.querySelector('.multi');if(a.directores?.length>1){if(!multi){multi=document.createElement('span');multi.className='multi';s.el.appendChild(multi)}multi.textContent='×'+a.directores.length;multi.title=a.directores.map(d=>d.nombre+' ('+d.donde+', '+d.estado+')').join('\n')}else multi?.remove();
  s.n.textContent=a.nombre+(a.tipo==='codex'?' · CODEX':'');s.n.title=a.directores?.length>1?a.directores.map(d=>d.nombre+' ('+d.donde+', '+d.estado+')').join('\n'):a.nombre;s.el.setAttribute('aria-label',a.nombre+', '+estTxt(a));
  if(a.tipo==='codex')s.n.style.maxWidth='7cqw'}
 // etiquetas de escritorios ausentes
 for(const[k,v]of[...vac]){v.remove();vac.delete(k)}
 crearBotones();
 let ve=ov.querySelector('.vacio');if(!all.length&&!ve){ve=document.createElement('div');ve.className='vacio';ve.textContent=T('oficina_vacia');ov.appendChild(ve)}else if(all.length&&ve)ve.remove();
 const li=(box,arr,fn)=>{const ul=$(box).querySelector('ul');ul.textContent='';for(const a of arr){const l=document.createElement('li');fn(l,a);ul.appendChild(l)}$(box).style.display=arr.length?'':'none'};
 li('term',g.term,(l,a)=>{l.textContent=(a.ok?'✓ ':'■ ')+a.nombre+(a.vuelta?' · '+a.vuelta:'');if(a.ok)l.className='ok'});
 li('hist',g.hist,(l,a)=>{l.textContent=a.nombre+(a.carpeta?' · '+a.carpeta:'')+(a.upd?' · '+hms(new Date(a.upd)).slice(0,5):'')});
 const old=new Set(feedAll.map(e=>e.h+e.t));feedAll=d.feed||[];
 const nuevos=feedAll.filter(e=>!old.has(e.h+e.t));
 if(!primera&&nuevos.length)conversar(nuevos.reverse());
 const f=$('feed');f.textContent='';for(const e of feedAll.slice(0,6)){const dv=document.createElement('div');const b=document.createElement('b');b.textContent=e.h;dv.append(b,' '+feedTxt(e));f.appendChild(dv)}
 if(!feedAll.length)f.textContent=T('sin_novedades');
 cupoUI(d.cupo);reuniones(d.reuniones||[]);primera=false;if(RM)requestAnimationFrame(t=>frame(t,0))}
const vac=new Map(),creables=new Map();let creablesKey='';
// «➕ Crear agente aquí» en cada escritorio sin agente del roster ni sesión viva (se rehacen solo si cambian).
function crearBotones(){const libres=[];for(let p=0;p<LAY.nz;p++)for(let i=0;i<capZ(p);i++){const o=seatOcc.get(p+':'+i);if(!o||!o.live)libres.push([p,i])}
 const k=JSON.stringify([libres,DY,LAY.hueco,ZON]);if(k===creablesKey)return;creablesKey=k;for(const b of creables.values())b.remove();creables.clear();
 const boton=(cls,txt,tt,[x,y,w,h],fn,key)=>{const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=txt;b.title=tt;b.style.cssText=`left:${x/W*100}%;top:${y/H*100}%;width:${w/W*100}%;height:${h/H*100}%`;b.onclick=e=>{e.stopPropagation();if(!suppress)fn()};ov.appendChild(b);creables.set(key,b)};
 for(let p=0;p<LAY.nz;p++)boton('zona-btn','✏️ '+ZON[p],T('editar_zona')+' · '+ZON[p],[POD0+(p%3)*PODW-6,LAY.y0[zfila(p)],82,9],()=>GH.editarZona?.(p),'z'+p);
 if(LAY.hueco>=0){const h=LAY.hueco;boton('crear-zona',T('crear_zona'),T('crear_zona'),[POD0+(h%3)*PODW-6,LAY.y0[zfila(h)],82,LAY.filas[zfila(h)]*48+2],()=>GH.crearZona?.(h),'hz')}
 for(const[p,i]of libres){const[sx,sy]=seatXY(p,i),b=document.createElement('button');b.type='button';b.className='crear';b.textContent=T('crear_aqui');b.title=T('crear_aqui')+' · '+ZON[p];
  b.style.cssText=`left:${sx/W*100}%;top:${sy/H*100}%;width:${28/W*100}%;height:${20/H*100}%`;b.onclick=e=>{e.stopPropagation();if(!suppress)GH.crear?.({zona:p,i})};
  b.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-oficina')){e.preventDefault();e.dataTransfer.dropEffect='move';b.classList.add('sobre')}};b.ondragleave=()=>b.classList.remove('sobre');b.ondrop=e=>{e.preventDefault();e.stopPropagation();b.classList.remove('sobre');document.body.classList.remove('arrastrando');try{const a=st.get(JSON.parse(e.dataTransfer.getData('application/x-oficina')).id)?.a;if(a&&!a.roster&&!a.dir)GH.adoptar?.(a,{zona:p,i})}catch{}};ov.appendChild(b);creables.set(p+':'+i,b)}}
function setPendientes(n){PEND=n;const gs=[...st.values()].find(s=>s.a.dir);
 if(gs){let b=gs.el.querySelector('.pq');if(n){if(!b){b=document.createElement('div');b.className='burb pq';gs.el.appendChild(b)}b.textContent=T('necesito_ok',{n})}else if(b)b.remove()}}
function cupoUI(c){
 const hh=v=>Number.isFinite(v)?new Date(v*1000).toLocaleTimeString(L,{hour12:false,hour:'2-digit',minute:'2-digit'}):'—';
 for(const [motor,canvas,linea,semana]of[['codex','bat','cx','cs'],['claude','bat2','ccx','ccs']]){
  const x=$(canvas).getContext('2d'),k=c?.[motor];x.clearRect(0,0,20,9);R(x,'#26304a',0,0,17,9);R(x,'#26304a',17,3,2,3);R(x,'#f6f4ea',1,1,15,7);
  const uso=Number.isFinite(k?.usado)?clamp(k.usado,0,100):null,ss=Number.isFinite(k?.semana)?clamp(k.semana,0,100):null;
  R(x,uso===null?'#bbb':uso>80?'#f0a020':'#4caf50',2,2,uso===null?13:Math.round(13*(100-uso)/100),5);
  $(linea).textContent=uso===null?(motor==='claude'&&k?.renuevaTexto?'Claude: '+k.renuevaTexto:T(motor+'_sin')):(motor==='claude'?'Claude: '+Math.round(uso)+' % (5 h), '+(L==='es'?'renueva ':'resets ')+hh(k.renueva):T('codex_uso',{u:Math.round(uso),h:hh(k.renueva)}));
  $(semana).textContent=ss===null?'':T('codex_semana',{s:Math.round(ss),h:hh(k.renueva_semana)});
  $(linea).title=k?.visto?(L==='es'?'Dato local: ':'Local data: ')+new Date(k.visto*1000).toLocaleString(L)+(k.fuente?' · '+k.fuente:''):'';
 }
}
let reunKey='';
function reuniones(rs){const ahora=Date.now()/1000,act=rs.filter(r=>ahora-r.ts<180);
 const por=n=>[...st.values()].find(s=>s.a.tipo!=='temp'&&(s.a.nombre===n||s.a.raw===n||s.a.sesion===n));
 const r=act.slice(-1)[0];meet=null;
 if(r){const A=por(r.de),B=por(r.para),key=r.de+r.para+r.ts;
  if(A){meet={A,B:B||null,ts:r.ts};if(!B&&A.a.dir)meet=null}else if(B&&B.a.dir===false&&false){}
  if(A&&key!==reunKey){habla(A,T('reunion_burb',{b:B?B.a.nombre:T('un_ayudante')})+(r.tema?': '+r.tema:''),9000)}reunKey=key}else reunKey=''}
// ===== Cámara: zoom, arrastre, reiniciar =====
const vp=$('vp'),cam=$('cam');let zoom=1,pan={x:0,y:0},drag=null,suppress=false;
const movil=()=>innerWidth<=760;
function applyCam(){if(movil()){cam.style.transform='';return}const w=vp.clientWidth,h=vp.clientHeight;zoom=clamp(zoom,1,2.6);pan.x=clamp(pan.x,w-w*zoom,0);pan.y=clamp(pan.y,h-h*zoom,0);cam.style.transform=`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}
vp.addEventListener('wheel',e=>{if(movil())return;e.preventDefault();const r=vp.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,nz=clamp(zoom*(e.deltaY<0?1.15:1/1.15),1,2.6);pan.x=mx-(mx-pan.x)*nz/zoom;pan.y=my-(my-pan.y)*nz/zoom;zoom=nz;applyCam()},{passive:false});
vp.addEventListener('pointerdown',e=>{if(movil()||e.button)return;drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y,m:false}});
addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.m&&Math.hypot(dx,dy)>5)drag.m=true;if(drag.m){pan.x=drag.px+dx;pan.y=drag.py+dy;applyCam();$('tip').style.display='none'}});
addEventListener('pointerup',()=>{if(drag&&drag.m){suppress=true;setTimeout(()=>suppress=false,0)}drag=null});
vp.addEventListener('click',e=>{if(suppress){e.stopPropagation();e.preventDefault()}},true);
const reset=()=>{zoom=1;pan={x:0,y:0};applyCam()};$('zoomb').onclick=reset;vp.addEventListener('dblclick',e=>{if(!e.target.closest('.st'))reset()});
addEventListener('resize',()=>{applyCam();if(RM)requestAnimationFrame(t=>frame(t,0))});
function seleccionar(id){sel=id;for(const s of st.values())s.el.classList.toggle('sel',s.a.id===sel)}
const ganchos=h=>{GH=h};
// Arranca la escena con la configuración pública y el idioma.
function zonasDe(of){CFG.oficina=of;const z=of.zonas;ZON=[...z.map(x=>x.nombre),T('zona_temp')];ZP=z.map(x=>{try{return x.patron?new RegExp(x.patron,'i'):null}catch{return null}})}
function iniciar(cfg,idioma){CFG=cfg;L=idioma;zonasDe(cfg.oficina);paintBg();requestAnimationFrame(loop)}
// Las zonas cambiaron desde la web: se rehace el plano en el próximo aplicar().
function actualizarZonas(of){zonasDe(of);LAY={...LAY,nz:-1};creablesKey='';slots.clear()}
const listaAgentes=()=>[...st.values()].map(s=>s.a);
export{aplicar,setPendientes,seleccionar,ganchos,listaAgentes,iniciar,actualizarZonas};

const soltar=$('soltar');
soltar.ondragover=e=>{if(e.dataTransfer.types.includes('application/x-oficina')){e.preventDefault();soltar.classList.add('sobre')}};
soltar.ondragleave=()=>soltar.classList.remove('sobre');
soltar.ondrop=e=>{e.preventDefault();soltar.classList.remove('sobre');document.body.classList.remove('arrastrando');try{const a=st.get(JSON.parse(e.dataTransfer.getData('application/x-oficina')).id)?.a;if(a?.roster&&!a.dir)GH.quitar?.(a)}catch{}};
