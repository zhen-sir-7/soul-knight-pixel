// ============================================================
// 元气骑士 (Soul Knight) - 完整游戏实现
// ============================================================

// ---- Canvas Setup ----
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const BASE_W = 960, BASE_H = 640;
canvas.width = BASE_W; canvas.height = BASE_H;

function resizeCanvas() {
  const maxW = window.innerWidth - 20;
  const maxH = window.innerHeight - 20;
  const scale = Math.min(maxW / BASE_W, maxH / BASE_H);
  canvas.style.width = Math.floor(BASE_W * scale) + 'px';
  canvas.style.height = Math.floor(BASE_H * scale) + 'px';
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ---- Game State ----
let game = null;
let gameRunning = false;
let gameLoopId = null;

// ---- Constants ----
const TILE = 48;
const ROOM_W = 18;
const ROOM_H = 13;

// ---- Input ----
const keys = {};
const mouse = { x: BASE_W/2, y: BASE_H/2, down: false };

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === 'e' && game && game.player && !game.gameOver && game.started) game.player.roll();
  if (k === 'r' && game && game.player && !game.gameOver && game.started) game.player.switchWeapon();
});
document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width, sy = canvas.height / r.height;
  mouse.x = (e.clientX - r.left) * sx;
  mouse.y = (e.clientY - r.top) * sy;
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
canvas.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
// ---- Utility ----
function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function dist(a, b) { return Math.hypot((a.x||a) - (b.x||b), (a.y||a) - (b.y||b)); }
function angle(a, b) { return Math.atan2((b.y||b) - (a.y||a), (b.x||b) - (a.x||a)); }

// roundRect polyfill for older browsers
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r, w/2, h/2) || 0;
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.quadraticCurveTo(x + w, y, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - r);
    this.lineTo(x, y + r);
    this.quadraticCurveTo(x, y, x + r, y);
    this.closePath();
    return this;
  };
}

// ---- Particle ----
class Particle {
  constructor(x, y, vx, vy, life, color, size, type) {
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.life=this.maxLife=life; this.color=color;
    this.size=size; this.type=type||'circle';
  }
  update(dt) { this.x+=this.vx*dt; this.y+=this.vy*dt; this.life-=dt; return this.life>0; }
  draw(ctx, cam) {
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-50||sx>BASE_W+50||sy<-50||sy>BASE_H+50) return;
    const a=clamp(this.life/this.maxLife,0,1), s=this.size*(0.3+0.7*a);
    ctx.globalAlpha=a;
    if (this.type==='circle') { ctx.fillStyle=this.color; ctx.beginPath(); ctx.arc(sx,sy,s,0,Math.PI*2); ctx.fill(); }
    else { ctx.strokeStyle=this.color; ctx.lineWidth=Math.max(1,s); ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx-this.vx*2,sy-this.vy*2); ctx.stroke(); }
    ctx.globalAlpha=1;
  }
}

function spawnExplosion(x,y,color,count,speed,life) {
  count=count||20; speed=speed||200; life=life||0.6;
  for (let i=0;i<count;i++) {
    const a=rand(0,Math.PI*2), sp=rand(50,speed);
    game.particles.push(new Particle(x+rand(-4,4),y+rand(-4,4),Math.cos(a)*sp,Math.sin(a)*sp,rand(0.2,life),color,rand(2,5),Math.random()>0.3?'circle':'spark'));
  }
}
function spawnHitEffect(x,y) {
  for (let i=0;i<5;i++) { const a=rand(0,Math.PI*2); game.particles.push(new Particle(x,y,Math.cos(a)*rand(30,100),Math.sin(a)*rand(30,100),rand(0.1,0.3),'#fff',rand(1,2),'circle')); }
}
// ---- Weapons ----
const WEAPONS = {
  pistol: { name:'新手手枪', damage:3, speed:600, fireRate:0.22, spread:0.06, bulletSize:4, bulletColor:'#ffd54f', trailColor:'#ffecb3', knockback:100, shots:1, auto:false, range:500, pierce:false },
  shotgun: { name:'霰弹枪', damage:4, speed:550, fireRate:0.5, spread:0.22, bulletSize:5, bulletColor:'#ff8a65', trailColor:'#ffccbc', knockback:150, shots:5, auto:false, range:350, pierce:false },
  machinegun: { name:'机关枪', damage:2, speed:650, fireRate:0.07, spread:0.14, bulletSize:3, bulletColor:'#81c784', trailColor:'#c8e6c9', knockback:50, shots:1, auto:true, range:400, pierce:false },
  sniper: { name:'狙击步枪', damage:12, speed:900, fireRate:0.85, spread:0.01, bulletSize:6, bulletColor:'#ce93d8', trailColor:'#e1bee7', knockback:250, shots:1, auto:false, range:800, pierce:true },
  rocket: { name:'火箭炮', damage:18, speed:350, fireRate:1.2, spread:0.04, bulletSize:10, bulletColor:'#ef5350', trailColor:'#ffcdd2', knockback:300, shots:1, auto:false, range:600, pierce:false, explosive:true, explosionRadius:80, explosionDamage:10 },
  laser: { name:'激光枪', damage:1, speed:0, fireRate:0.035, spread:0.02, bulletSize:3, bulletColor:'#4fc3f7', trailColor:'#b3e5fc', knockback:20, shots:1, auto:true, range:450, pierce:true, isLaser:true, laserDuration:0.1 }
};
const WEAPON_LIST = Object.keys(WEAPONS);
// ---- Player ----
class Player {
  constructor(x, y) {
    this.x=x; this.y=y;
    this.w=28; this.h=28;
    this.hp=20; this.maxHp=20;
    this.shield=10; this.maxShield=10;
    this.shieldRegenCooldown=0; // 护盾恢复倒计时(秒)
    this.speed=180;
    this.rollSpeed=350;
    this.rollDuration=0.25;
    this.rollCooldown=0.6;
    this.rollTimer=0;
    this.rollCooldownTimer=0;
    this.rollDir={x:0,y:0};
    this.weaponIdx=0;
    this.weapons=['pistol'];
    this.fireTimer=0;
    this.invincibleTimer=0;
    this.invincibleDuration=0.3;
    this.knockbackVx=0; this.knockbackVy=0;
    this.alive=true;
    this.gold=0;
    this.meleeTimer=0;
    this.hitFlashTimer=0;
  }
  getWeapon() { return WEAPONS[this.weapons[this.weaponIdx]]; }
  getWeaponName() { return this.getWeapon().name; }

  roll() {
    if (this.rollTimer>0||this.rollCooldownTimer>0||!this.alive) return;
    this.rollTimer=this.rollDuration;
    this.rollCooldownTimer=this.rollCooldown;
    this.invincibleTimer=Math.max(this.invincibleTimer,this.rollDuration);
    let dx=0, dy=0;
    if (keys['w']) dy=-1; if (keys['s']) dy=1;
    if (keys['a']) dx=-1; if (keys['d']) dx=1;
    if (dx===0&&dy===0) { dx=Math.cos(this.aimAngle); dy=Math.sin(this.aimAngle); }
    const len=Math.hypot(dx,dy);
    if (len>0) { dx/=len; dy/=len; }
    this.rollDir={x:dx, y:dy};
    for (let i=0;i<12;i++) {
      game.particles.push(new Particle(this.x+rand(-4,4),this.y+rand(-4,4),-dx*rand(30,80),-dy*rand(30,80),rand(0.15,0.35),'#90caf9',rand(2,4),'circle'));
    }
  }

  switchWeapon() {
    if (this.weapons.length<2) return;
    this.weaponIdx=(this.weaponIdx+1)%this.weapons.length;
  }

  takeDamage(dmg) {
    if (this.invincibleTimer>0||!this.alive) return;
    let shieldAbsorb=Math.min(this.shield,dmg);
    this.shield-=shieldAbsorb;
    let hpDmg=dmg-shieldAbsorb;
    if (hpDmg>0) {
      this.hp-=hpDmg;
      this.hitFlashTimer=0.15;
    }
    this.invincibleTimer=this.invincibleDuration;
    this.shieldRegenCooldown=1.0; // 受伤后1秒内不回复护盾
    if (this.hp<=0) { this.hp=0; this.alive=false; }
  }

  heal(amount) {
    this.hp=Math.min(this.maxHp,this.hp+amount);
  }

  shieldRestore(amount) {
    this.shield=Math.min(this.maxShield,this.shield+amount);
  }
  update(dt) {
    if (!this.alive) return;
    this.fireTimer=Math.max(0,this.fireTimer-dt);
    this.rollTimer=Math.max(0,this.rollTimer-dt);
    this.rollCooldownTimer=Math.max(0,this.rollCooldownTimer-dt);
    this.invincibleTimer=Math.max(0,this.invincibleTimer-dt);
    this.hitFlashTimer=Math.max(0,this.hitFlashTimer-dt);
    this.shieldRegenCooldown=Math.max(0,this.shieldRegenCooldown-dt);
    if (this.shieldRegenCooldown<=0&&this.shield<this.maxShield) {
      this.shield=Math.min(this.maxShield,this.shield+5*dt);
    }
    this.meleeTimer=Math.max(0,this.meleeTimer-dt);

    // knockback decay
    this.knockbackVx*=0.85; this.knockbackVy*=0.85;
    if (Math.abs(this.knockbackVx)<1) this.knockbackVx=0;
    if (Math.abs(this.knockbackVy)<1) this.knockbackVy=0;

    // roll movement
    if (this.rollTimer>0) {
      this.x+=this.rollDir.x*this.rollSpeed*dt;
      this.y+=this.rollDir.y*this.rollSpeed*dt;
      // roll particles
      if (Math.random()<0.4) {
        game.particles.push(new Particle(this.x+rand(-6,6),this.y+rand(-6,6),-this.rollDir.x*rand(20,60),-this.rollDir.y*rand(20,60),rand(0.1,0.25),'#bbdefb',rand(2,3),'circle'));
      }
    } else {
      // normal movement
      let dx=0, dy=0;
      if (keys['w']) dy=-1; if (keys['s']) dy=1;
      if (keys['a']) dx=-1; if (keys['d']) dx=1;
      if (dx!==0||dy!==0) {
        const len=Math.hypot(dx,dy);
        dx/=len; dy/=len;
        this.x+=(dx*this.speed+this.knockbackVx)*dt;
        this.y+=(dy*this.speed+this.knockbackVy)*dt;
      } else {
        this.x+=this.knockbackVx*dt;
        this.y+=this.knockbackVy*dt;
      }
    }

    // aim angle
    this.aimAngle=angle(this, mouse);

    // auto fire
    const wep=this.getWeapon();
    if ((mouse.down||wep.auto)&&this.fireTimer<=0&&this.rollTimer<=0) {
      this.fireTimer=wep.fireRate;
      game.spawnBullet(this, wep, this.aimAngle);
    }
  }
  draw(ctx, cam) {
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (this.hitFlashTimer>0&&Math.floor(this.hitFlashTimer*30)%2===0) { ctx.globalAlpha=0.6; }

    // shadow
    ctx.fillStyle='rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(sx,sy+16,14,5,0,0,Math.PI*2); ctx.fill();

    // invincibility glow (无敌帧视觉)
    if (this.invincibleTimer>0) {
      ctx.save();
      ctx.shadowColor='#4fc3f7'; ctx.shadowBlur=20;
      ctx.fillStyle='rgba(79,195,247,0.15)';
      ctx.beginPath(); ctx.arc(sx,sy,22,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // body
    const bobY=this.rollTimer>0?0:Math.sin(Date.now()*0.008)*2;
    ctx.fillStyle='#1565c0';
    ctx.beginPath(); ctx.roundRect(sx-14,sy-14+bobY,28,28,4); ctx.fill();
    // inner
    ctx.fillStyle='#1976d2';
    ctx.beginPath(); ctx.roundRect(sx-10,sy-10+bobY,20,20,3); ctx.fill();

    // roll indicator
    if (this.rollCooldownTimer>0) {
      ctx.strokeStyle='rgba(144,202,249,'+(0.3+0.3*Math.sin(Date.now()*0.01))+')';
      ctx.lineWidth=2; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.roundRect(sx-16,sy-16+bobY,32,32,5); ctx.stroke();
      ctx.setLineDash([]);
    }

    // weapon
    const wa=this.aimAngle;
    const wLen=20;
    ctx.save(); ctx.translate(sx,sy+bobY); ctx.rotate(wa);
    const wep=this.getWeapon();
    ctx.fillStyle='#6d4c41'; ctx.fillRect(6,-3,wLen,6);
    ctx.fillStyle='#8d6e63'; ctx.fillRect(8,-2,wLen-4,4);
    if (wep.name.includes('剑')||wep.name.includes('刀')) {
      ctx.fillStyle='#bdbdbd'; ctx.fillRect(18,-5,14,10);
    }
    ctx.restore();

    // eyes
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx-5+Math.cos(wa)*4,sy-3+bobY,3,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+5+Math.cos(wa)*4,sy-3+bobY,3,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-5+Math.cos(wa)*5,sy-3+bobY,1.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+5+Math.cos(wa)*5,sy-3+bobY,1.5,0,Math.PI*2); ctx.fill();

    ctx.globalAlpha=1;

    // HP bar
    const barW=40, barH=4, barX=sx-20, barY=sy-26+bobY;
    ctx.fillStyle='#333'; ctx.fillRect(barX,barY,barW,barH);
    ctx.fillStyle='#ef5350'; ctx.fillRect(barX,barY,barW*(this.hp/this.maxHp),barH);
    if (this.shield>0) {
      ctx.fillStyle='#42a5f5'; ctx.fillRect(barX,barY-5,barW*(this.shield/this.maxShield),3);
    }
  }
}
// ---- Bullet ----
class Bullet {
  constructor(x,y,vx,vy,damage,weapon,isEnemy) {
    this.x=x; this.y=y; this.vx=vx; this.vy=vy;
    this.damage=damage; this.weapon=weapon;
    this.isEnemy=isEnemy||false;
    this.trail=[];
    this.alive=true;
    this.distTraveled=0;
  }
  update(dt) {
    if (!this.alive) return;
    this.x+=this.vx*dt; this.y+=this.vy*dt;
    this.distTraveled+=Math.hypot(this.vx*dt,this.vy*dt);
    if (this.distTraveled>this.weapon.range) { this.alive=false; return; }
    // trail
    this.trail.push({x:this.x,y:this.y});
    if (this.trail.length>6) this.trail.shift();
    // collision with walls
    const tx=Math.floor(this.x/TILE), ty=Math.floor(this.y/TILE);
    if (game.room&&game.room.grid&&game.room.grid[ty]&&game.room.grid[ty][tx]===1) { this.alive=false; if (this.weapon.explosive) spawnExplosion(this.x,this.y,'#ff5722',25,250,0.5); return; }
  }
  draw(ctx, cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-50||sx>BASE_W+50||sy<-50||sy>BASE_H+50) return;
    // trail
    for (let i=0;i<this.trail.length;i++) {
      const a=i/this.trail.length;
      ctx.globalAlpha=a*0.5;
      ctx.fillStyle=this.weapon.trailColor||this.weapon.bulletColor;
      ctx.beginPath(); ctx.arc(this.trail[i].x-cam.x,this.trail[i].y-cam.y,this.weapon.bulletSize*a,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
    // bullet
    ctx.fillStyle=this.weapon.bulletColor;
    ctx.beginPath(); ctx.arc(sx,sy,this.weapon.bulletSize,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(sx-this.weapon.bulletSize*0.3,sy-this.weapon.bulletSize*0.3,this.weapon.bulletSize*0.4,0,Math.PI*2); ctx.fill();
  }
}

// ---- LaserBeam ----
class LaserBeam {
  constructor(x,y,angle,weapon,isEnemy) {
    this.x=x; this.y=y; this.angle=angle;
    this.weapon=weapon; this.isEnemy=isEnemy||false;
    this.life=weapon.laserDuration||0.1; this.maxLife=this.life;
    this.alive=true; this.hitTargets=new Set();
    this.damage=weapon.damage; this.range=weapon.range;
  }
  update(dt) {
    this.life-=dt;
    if (this.life<=0) { this.alive=false; }
  }
  draw(ctx, cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    const a=this.life/this.maxLife;
    const endX=sx+Math.cos(this.angle)*this.range;
    const endY=sy+Math.sin(this.angle)*this.range;
    ctx.globalAlpha=a*0.8;
    // outer glow
    ctx.shadowColor='#4fc3f7'; ctx.shadowBlur=20;
    ctx.strokeStyle='rgba(79,195,247,0.3)'; ctx.lineWidth=12;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(endX,endY); ctx.stroke();
    // middle
    ctx.shadowBlur=10;
    ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(endX,endY); ctx.stroke();
    // core
    ctx.shadowBlur=0;
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(endX,endY); ctx.stroke();
    ctx.globalAlpha=1;
  }
}
// ---- Enemy Base Class ----
class EnemyBase {
  constructor(x,y,config) {
    this.x=x; this.y=y;
    this.w=config.w||30; this.h=config.h||30;
    this.hp=config.hp||6; this.maxHp=this.hp;
    this.speed=config.speed||60;
    this.damage=config.damage||5;
    this.goldValue=config.gold||5;
    this.color=config.color||'#e53935';
    this.type=config.type||'slime';
    this.alive=true;
    this.knockbackVx=0; this.knockbackVy=0;
    this.fireTimer=0;
    this.attackCooldown=config.attackCooldown||1;
    this.hitFlash=0;
    this.scoreValue=config.score||10;
  }
  takeDamage(dmg) {
    this.hp-=dmg;
    this.hitFlash=0.1;
    if (this.hp<=0) { this.hp=0; this.alive=false; }
  }
  applyKnockback(vx,vy,power) {
    this.knockbackVx+=vx*power; this.knockbackVy+=vy*power;
  }
  isOnScreen(cam) {
    return this.x>cam.x-80&&this.x<cam.x+BASE_W+80&&this.y>cam.y-80&&this.y<cam.y+BASE_H+80;
  }
}

// ---- Slime Enemy ----
class SlimeEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.15;
    super(x,y,{w:28,h:28,hp:Math.floor(6*f),speed:50+level*5,damage:5,gold:3,type:'slime',score:10});
    this.bounceTimer=0; this.bounceSpeed=3; this.phase=0;
    this.baseColor='#66bb6a'; this.level=level;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.85; this.knockbackVy*=0.85;
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    if (d>0&&d<350) {
      const sp=this.speed*(0.8+0.4*Math.sin(Date.now()*0.005));
      const mx=(dx/d)*sp+this.knockbackVx, my=(dy/d)*sp+this.knockbackVy;
      this.x+=mx*dt; this.y+=my*dt;
      this.bounceTimer+=dt*this.bounceSpeed;
      this.phase+=dt;
    }
    // contact damage
    if (d<this.w/2+14) {
      player.takeDamage(this.damage);
      const a=angle(this,player);
      player.knockbackVx=Math.cos(a)*300; player.knockbackVy=Math.sin(a)*300;
    }
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-60||sx>BASE_W+60||sy<-60||sy>BASE_H+60) return;
    const bounce=Math.sin(this.bounceTimer)*2;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    // body - slime blob
    ctx.fillStyle=col; ctx.beginPath();
    ctx.ellipse(sx,sy+bounce/2+2,16,12+Math.sin(this.bounceTimer+1)*2,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#81c784';
    ctx.beginPath(); ctx.ellipse(sx,sy+bounce/2,12,10,0,0,Math.PI*2); ctx.fill();
    // eyes
    const ea=angle(this,game.player);
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx-4+Math.cos(ea)*2,sy-3+bounce/2,2.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+4+Math.cos(ea)*2,sy-3+bounce/2,2.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-3+Math.cos(ea)*3,sy-3+bounce/2,1.2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+5+Math.cos(ea)*3,sy-3+bounce/2,1.2,0,Math.PI*2); ctx.fill();
    // HP bar
    if (this.hp<this.maxHp) {
      ctx.fillStyle='#333'; ctx.fillRect(sx-12,sy-20,24,3);
      ctx.fillStyle='#ef5350'; ctx.fillRect(sx-12,sy-20,24*(this.hp/this.maxHp),3);
    }
  }
}
// ---- Archer Enemy ----
class ArcherEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.12;
    super(x,y,{w:28,h:32,hp:Math.floor(4*f),speed:40+level*3,damage:4,gold:5,type:'archer',attackCooldown:1.8-(level*0.05),score:15});
    this.retreatDist=200; this.attackRange=450;
    this.baseColor='#7e57c2'; this.level=level;
    this.bulletSpeed=350+level*10;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.9; this.knockbackVy*=0.9;
    this.fireTimer=Math.max(0,this.fireTimer-dt);
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    if (d>0) {
      if (d<this.retreatDist) {
        // retreat
        const sp=this.speed*0.7;
        this.x-=dx/d*sp*dt; this.y-=dy/d*sp*dt;
      } else if (d>this.attackRange) {
        // approach
        this.x+=dx/d*this.speed*0.5*dt; this.y+=dy/d*this.speed*0.5*dt;
      } else {
        // strafe
        const strafeAngle=Math.atan2(dy,dx)+Math.PI/2*Math.sin(Date.now()*0.002);
        this.x+=Math.cos(strafeAngle)*this.speed*0.4*dt; this.y+=Math.sin(strafeAngle)*this.speed*0.4*dt;
      }
      this.x+=this.knockbackVx*dt; this.y+=this.knockbackVy*dt;
      // shoot
      if (d<this.attackRange&&this.fireTimer<=0) {
        this.fireTimer=this.attackCooldown;
        const a=angle(this,player), spread=0.12;
        const ba=a+rand(-spread,spread);
        const bullet=new Bullet(this.x,this.y,Math.cos(ba)*this.bulletSpeed,Math.sin(ba)*this.bulletSpeed,this.damage,{bulletSize:4,bulletColor:'#ce93d8',trailColor:'#e1bee7',range:600,explosive:false,pierce:false},true);
        game.enemyBullets.push(bullet);
        // muzzle flash
        for (let i=0;i<3;i++) { const a2=ba+rand(-0.3,0.3); game.particles.push(new Particle(this.x+Math.cos(ba)*16,this.y+Math.sin(ba)*16,Math.cos(a2)*rand(20,60),Math.sin(a2)*rand(20,60),0.2,'#d1c4e9',rand(1,2),'circle')); }
      }
    }
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-60||sx>BASE_W+60||sy<-60||sy>BASE_H+60) return;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    // body
    ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(sx-12,sy-16,24,30,4); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#9575cd';
    ctx.beginPath(); ctx.roundRect(sx-9,sy-12,18,22,3); ctx.fill();
    // bow
    const ba=angle(this,game.player);
    ctx.save(); ctx.translate(sx,sy); ctx.rotate(ba);
    ctx.strokeStyle='#5d4037'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(10,0,12,-Math.PI/3,Math.PI/3); ctx.stroke();
    ctx.strokeStyle='#8d6e63'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(10+Math.cos(-Math.PI/3)*12,Math.sin(-Math.PI/3)*12);
    ctx.lineTo(10+Math.cos(Math.PI/3)*12,Math.sin(Math.PI/3)*12); ctx.stroke();
    ctx.restore();
    // eyes
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx-4,sy-4,2.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+4,sy-4,2.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-3,sy-4,1.2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+5,sy-4,1.2,0,Math.PI*2); ctx.fill();
    if (this.hp<this.maxHp) {
      ctx.fillStyle='#333'; ctx.fillRect(sx-12,sy-24,24,3);
      ctx.fillStyle='#ef5350'; ctx.fillRect(sx-12,sy-24,24*(this.hp/this.maxHp),3);
    }
  }
}

// ---- Big Enemy ----
class BigEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.2;
    super(x,y,{w:44,h:44,hp:Math.floor(16*f),speed:30+level*3,damage:8,gold:10,type:'big',attackCooldown:2.5-(level*0.05),score:30});
    this.chargeSpeed=400; this.chargeTimer=0; this.isCharging=false;
    this.chargeCooldown=3; this.chargeDuration=0.6;
    this.baseColor='#e65100'; this.level=level;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.9; this.knockbackVy*=0.9;
    this.chargeTimer=Math.max(0,this.chargeTimer-dt);
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    if (this.isCharging) {
      this.x+=this.chargeVx*dt; this.y+=this.chargeVy*dt;
      if (this.chargeTimer<=0||d<this.w/2+12) { this.isCharging=false; if (d<this.w/2+12) player.takeDamage(this.damage*1.5); }
      // charge particles
      if (Math.random()<0.5) { game.particles.push(new Particle(this.x+rand(-8,8),this.y+rand(-8,8),-this.chargeVx*0.2+rand(-20,20),-this.chargeVy*0.2+rand(-20,20),rand(0.1,0.3),'#ff8a65',rand(2,4),'circle')); }
    } else {
      // slow pursuit
      if (d>0) { this.x+=dx/d*this.speed*dt; this.y+=dy/d*this.speed*dt; }
      this.x+=this.knockbackVx*dt; this.y+=this.knockbackVy*dt;
      // start charge
      if (this.chargeTimer<=0&&d<500&&d>80) {
        this.isCharging=true; this.chargeTimer=this.chargeDuration;
        const a=angle(this,player);
        this.chargeVx=Math.cos(a)*this.chargeSpeed; this.chargeVy=Math.sin(a)*this.chargeSpeed;
        this.chargeCooldownTimer=this.chargeCooldown;
      }
    }
    if (d<this.w/2+14&&!this.isCharging) player.takeDamage(this.damage);
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-60||sx>BASE_W+60||sy<-60||sy>BASE_H+60) return;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    // body
    ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(sx-20,sy-20,40,40,6); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#bf360c';
    ctx.beginPath(); ctx.roundRect(sx-16,sy-16,32,32,5); ctx.fill();
    // charge glow
    if (this.isCharging) { ctx.fillStyle='rgba(255,138,101,'+(0.2+0.3*Math.sin(Date.now()*0.03))+')'; ctx.beginPath(); ctx.roundRect(sx-24,sy-24,48,48,8); ctx.fill(); }
    // eyes
    ctx.fillStyle='#ffeb3b';
    ctx.beginPath(); ctx.arc(sx-6,sy-4,4,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+6,sy-4,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-5,sy-3,2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+7,sy-3,2,0,Math.PI*2); ctx.fill();
    if (this.hp<this.maxHp) {
      ctx.fillStyle='#333'; ctx.fillRect(sx-18,sy-28,36,3);
      ctx.fillStyle='#ef5350'; ctx.fillRect(sx-18,sy-28,36*(this.hp/this.maxHp),3);
    }
  }
}
// ---- Shield Enemy ----
class ShieldEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.15;
    super(x,y,{w:34,h:34,hp:Math.floor(8*f),speed:35+level*3,damage:6,gold:8,type:'shield',score:20});
    this.shieldActive=true; this.shieldRegenTimer=0; this.shieldRegenDelay=2;
    this.baseColor='#546e7a'; this.level=level;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.85; this.knockbackVy*=0.85;
    this.shieldRegenTimer=Math.max(0,this.shieldRegenTimer-dt);
    if (!this.shieldActive&&this.shieldRegenTimer<=0) this.shieldActive=true;
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    if (d>0) {
      const sp=this.speed*(0.5+0.5*(this.shieldActive?1:1.3));
      this.x+=dx/d*sp*dt; this.y+=dy/d*sp*dt;
      this.x+=this.knockbackVx*dt; this.y+=this.knockbackVy*dt;
    }
    if (d<this.w/2+14) player.takeDamage(this.damage);
  }
  takeDamage(dmg) {
    if (this.shieldActive) {
      const absorbed=Math.min(dmg,3);
      this.shieldActive=false; this.shieldRegenTimer=this.shieldRegenDelay;
      this.hitFlash=0.15;
      spawnExplosion(this.x,this.y,'#90a4ae',8,100,0.3);
      return;
    }
    super.takeDamage(dmg);
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-60||sx>BASE_W+60||sy<-60||sy>BASE_H+60) return;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(sx-16,sy-16,32,32,16); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#607d8b';
    ctx.beginPath(); ctx.roundRect(sx-13,sy-13,26,26,13); ctx.fill();
    if (this.shieldActive) {
      ctx.strokeStyle='rgba(144,202,249,'+(0.4+0.3*Math.sin(Date.now()*0.005))+')';
      ctx.lineWidth=3; ctx.beginPath(); ctx.arc(sx,sy,22,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='rgba(144,202,249,0.15)'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(sx,sy,26,0,Math.PI*2); ctx.stroke();
    }
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(sx-4,sy-3,2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+4,sy-3,2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-3,sy-3,1,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+5,sy-3,1,0,Math.PI*2); ctx.fill();
    if (this.hp<this.maxHp) {
      ctx.fillStyle='#333'; ctx.fillRect(sx-14,sy-24,28,3);
      ctx.fillStyle='#ef5350'; ctx.fillRect(sx-14,sy-24,28*(this.hp/this.maxHp),3);
    }
  }
}

// ---- Bat Enemy ----
class BatEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.1;
    super(x,y,{w:22,h:20,hp:Math.floor(3*f),speed:120+level*8,damage:3,gold:2,type:'bat',score:8});
    this.wobbleTimer=0; this.baseColor='#4e342e'; this.level=level;
    this.wobbleSpeed=6+Math.random()*2;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.8; this.knockbackVy*=0.8;
    this.wobbleTimer+=dt;
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    if (d>0) {
      const wobbleOffset=Math.sin(this.wobbleTimer*this.wobbleSpeed)*1.5;
      const perpX=-dy/d*wobbleOffset, perpY=dx/d*wobbleOffset;
      const sp=this.speed*(0.9+0.2*Math.sin(this.wobbleTimer*2));
      this.x+=(dx/d*sp+this.knockbackVx+perpX)*dt;
      this.y+=(dy/d*sp+this.knockbackVy+perpY)*dt;
    }
    if (d<this.w/2+14) player.takeDamage(this.damage);
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-60||sx>BASE_W+60||sy<-60||sy>BASE_H+60) return;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    const wingPhase=Math.sin(this.wobbleTimer*this.wobbleSpeed*2);
    // wings
    ctx.fillStyle='#3e2723';
    ctx.beginPath(); ctx.ellipse(sx-12,sy-2+wingPhase*2,10,5+wingPhase*3,0.2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(sx+12,sy-2+wingPhase*2,10,5+wingPhase*3,-0.2,0,Math.PI*2); ctx.fill();
    // body
    ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(sx,sy,7,9,0,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#5d4037';
    ctx.beginPath(); ctx.ellipse(sx,sy,5,7,0,0,Math.PI*2); ctx.fill();
    // eyes
    ctx.fillStyle='#ff5252';
    ctx.beginPath(); ctx.arc(sx-3,sy-2,2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+3,sy-2,2,0,Math.PI*2); ctx.fill();
  }
}
// ---- Boss Enemy ----
class BossEnemy extends EnemyBase {
  constructor(x,y,level) {
    const f=1+level*0.3;
    super(x,y,{w:56,h:56,hp:Math.floor(50*f),speed:40+level*3,damage:10,gold:50,type:'boss',score:100});
    this.level=level; this.phase=0; this.phaseTimer=0;
    this.phaseDuration=3; this.specialTimer=0; this.specialCooldown=4-level*0.1;
    this.bossWeapon={bulletSize:8,bulletColor:'#ef5350',trailColor:'#ffcdd2',range:700,explosive:false,pierce:false};
    this.baseColor='#b71c1c';
    this.patternIndex=0;
  }
  update(dt,player,room) {
    if (!this.alive) return;
    this.hitFlash=Math.max(0,this.hitFlash-dt);
    this.knockbackVx*=0.92; this.knockbackVy*=0.92;
    this.specialTimer=Math.max(0,this.specialTimer-dt);
    this.phaseTimer+=dt;
    const dx=player.x-this.x, dy=player.y-this.y;
    const d=Math.hypot(dx,dy);
    // phase transitions
    const hpRatio=this.hp/this.maxHp;
    if (hpRatio<0.3) this.phase=2;
    else if (hpRatio<0.6) this.phase=1;
    // movement
    if (this.phaseTimer>this.phaseDuration&&d<500) {
      if (Math.random()<0.02) { this.phaseTimer=0; }
      const strafeA=Math.atan2(dy,dx)+Math.PI/2*Math.sin(this.phaseTimer*1.5);
      const sp=this.speed*(1+this.phase*0.3);
      this.x+=Math.cos(strafeA)*sp*dt; this.y+=Math.sin(strafeA)*sp*dt;
    } else if (d>200) {
      this.x+=dx/d*this.speed*dt; this.y+=dy/d*this.speed*dt;
    }
    this.x+=this.knockbackVx*dt; this.y+=this.knockbackVy*dt;
    // attack patterns
    if (this.specialTimer<=0&&d<600) {
      this.specialTimer=this.specialCooldown-this.phase*0.3;
      const a=angle(this,player);
      if (this.phase===2) {
        // phase 2: spiral + aimed
        for (let i=0;i<12;i++) {
          const ba=a+i*(Math.PI*2/12)+Math.sin(Date.now()*0.003)*0.3;
          const b=new Bullet(this.x,this.y,Math.cos(ba)*300,Math.sin(ba)*300,5,this.bossWeapon,true);
          game.enemyBullets.push(b);
        }
        setTimeout(()=>{
          for (let i=0;i<8;i++) {
            const ba=a+i*(Math.PI*2/8)+Math.sin(Date.now()*0.005)*0.5;
            const b=new Bullet(this.x,this.y,Math.cos(ba)*350,Math.sin(ba)*350,4,this.bossWeapon,true);
            game.enemyBullets.push(b);
          }
        },300);
      } else if (this.phase===1) {
        // phase 1: burst
        for (let i=0;i<6;i++) {
          const ba=a+i*(Math.PI*2/6)+rand(-0.1,0.1);
          const b=new Bullet(this.x,this.y,Math.cos(ba)*320,Math.sin(ba)*320,4,this.bossWeapon,true);
          game.enemyBullets.push(b);
        }
      } else {
        // phase 0: single aimed
        for (let i=0;i<3;i++) {
          const ba=a+rand(-0.15,0.15);
          const b=new Bullet(this.x,this.y,Math.cos(ba)*400,Math.sin(ba)*400,6,this.bossWeapon,true);
          game.enemyBullets.push(b);
        }
      }
      spawnExplosion(this.x,this.y,'#ef5350',10,150,0.3);
    }
    // contact damage
    if (d<this.w/2+14) player.takeDamage(this.damage);
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-80||sx>BASE_W+80||sy<-80||sy>BASE_H+80) return;
    const col=this.hitFlash>0?'#fff':this.baseColor;
    const pulse=1+0.05*Math.sin(Date.now()*0.003);
    // aura
    const auraColor=this.phase===2?'#ef5350':this.phase===1?'#ff7043':'#ff8a65';
    ctx.fillStyle='rgba('+(this.phase===2?'239,83,80':this.phase===1?'255,112,67':'255,138,101')+',0.15)';
    ctx.beginPath(); ctx.arc(sx,sy,40*pulse,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='rgba('+(this.phase===2?'239,83,80':this.phase===1?'255,112,67':'255,138,101')+',0.3)';
    ctx.lineWidth=2; ctx.beginPath(); ctx.arc(sx,sy,40*pulse,0,Math.PI*2); ctx.stroke();
    // body
    ctx.fillStyle=col; ctx.beginPath(); ctx.roundRect(sx-26,sy-26,52,52,8); ctx.fill();
    ctx.fillStyle=this.hitFlash>0?'#fff':'#d32f2f';
    ctx.beginPath(); ctx.roundRect(sx-22,sy-22,44,44,6); ctx.fill();
    // crown
    ctx.fillStyle='#ffd54f'; ctx.beginPath();
    ctx.moveTo(sx-18,sy-26); ctx.lineTo(sx-22,sy-34); ctx.lineTo(sx-12,sy-28);
    ctx.lineTo(sx-6,sy-36); ctx.lineTo(sx, sy-28); ctx.lineTo(sx+6,sy-36);
    ctx.lineTo(sx+12,sy-28); ctx.lineTo(sx+22,sy-34); ctx.lineTo(sx+18,sy-26);
    ctx.closePath(); ctx.fill();
    // eyes
    ctx.fillStyle='#ffeb3b';
    ctx.beginPath(); ctx.arc(sx-8,sy-4,5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+8,sy-4,5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#212121';
    ctx.beginPath(); ctx.arc(sx-7,sy-3,2.5,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(sx+9,sy-3,2.5,0,Math.PI*2); ctx.fill();
    // HP bar
    const barW=48, barH=4;
    ctx.fillStyle='#333'; ctx.fillRect(sx-24,sy-40,barW,barH);
    ctx.fillStyle='#ef5350'; ctx.fillRect(sx-24,sy-40,barW*(this.hp/this.maxHp),barH);
    ctx.fillStyle='#fff'; ctx.font='8px monospace'; ctx.textAlign='center';
    ctx.fillText('BOSS',sx,sy-44);
  }
}
// ---- Drop ----
class Drop {
  constructor(x,y,type,value) {
    this.x=x; this.y=y; this.type=type; this.value=value;
    this.w=16; this.h=16;
    this.alive=true; this.lifeTimer=15;
    this.bobTimer=Math.random()*Math.PI*2;
    this.collected=false;
  }
  update(dt,player) {
    this.lifeTimer-=dt; this.bobTimer+=dt*3;
    if (this.lifeTimer<=0) { this.alive=false; return; }
    // attraction
    const d=dist(this,player);
    if (d<200) {
      const a=angle(this,player), sp=300*(1-d/200);
      this.x+=Math.cos(a)*sp*dt; this.y+=Math.sin(a)*sp*dt;
      if (d<20) { this.collected=true; this.alive=false; this.apply(player); }
    }
  }
  apply(player) {
    if (this.type==='gold') { player.gold+=this.value; game.totalGold+=this.value; }
    else if (this.type==='hp') { player.heal(this.value); for (let i=0;i<10;i++) { const a=rand(0,Math.PI*2); game.particles.push(new Particle(this.x,this.y,Math.cos(a)*rand(30,80),Math.sin(a)*rand(30,80),0.4,'#81c784',rand(2,4),'circle')); } }
    else if (this.type==='shield') { player.shieldRestore(this.value); for (let i=0;i<8;i++) { const a=rand(0,Math.PI*2); game.particles.push(new Particle(this.x,this.y,Math.cos(a)*rand(30,80),Math.sin(a)*rand(30,80),0.4,'#64b5f6',rand(2,4),'circle')); } }
    else if (this.type==='weapon') { this.addWeapon(player); }
  }
  addWeapon(player) {
    let newWep;
    const available=WEAPON_LIST.filter(w=>!player.weapons.includes(w));
    if (available.length>0) newWep=available[randInt(0,available.length-1)];
    else newWep=WEAPON_LIST[randInt(0,WEAPON_LIST.length-1)];
    if (!player.weapons.includes(newWep)) player.weapons.push(newWep);
    player.weaponIdx=player.weapons.length-1;
    for (let i=0;i<15;i++) { const a=rand(0,Math.PI*2); game.particles.push(new Particle(this.x,this.y,Math.cos(a)*rand(50,120),Math.sin(a)*rand(50,120),0.5,'#ce93d8',rand(3,5),'circle')); }
  }
  draw(ctx,cam) {
    if (!this.alive) return;
    const sx=this.x-cam.x, sy=this.y-cam.y;
    if (sx<-30||sx>BASE_W+30||sy<-30||sy>BASE_H+30) return;
    const bob=Math.sin(this.bobTimer)*3;
    const fade=this.lifeTimer<3?this.lifeTimer/3:1;
    ctx.globalAlpha=fade;
    if (this.type==='gold') {
      ctx.fillStyle='#ffd54f'; ctx.beginPath(); ctx.arc(sx,sy+bob,7,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ffb300'; ctx.beginPath(); ctx.arc(sx-1,sy-1+bob,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='6px monospace'; ctx.textAlign='center'; ctx.fillText('$',sx,sy+3+bob);
    } else if (this.type==='hp') {
      ctx.fillStyle='#ef5350'; ctx.beginPath(); ctx.roundRect(sx-6,sy-4+bob,12,10,3); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='8px monospace'; ctx.textAlign='center'; ctx.fillText('+',sx,sy+4+bob);
    } else if (this.type==='shield') {
      ctx.fillStyle='#42a5f5'; ctx.beginPath();
      const bx=sx, by=sy+bob;
      ctx.moveTo(bx,by-7); ctx.lineTo(bx+7,by-3); ctx.lineTo(bx+7,by+3);
      ctx.lineTo(bx,by+7); ctx.lineTo(bx-7,by+3); ctx.lineTo(bx-7,by-3);
      ctx.closePath(); ctx.fill();
    } else if (this.type==='weapon') {
      ctx.fillStyle='#ce93d8'; ctx.beginPath(); ctx.roundRect(sx-8,sy-8+bob,16,16,4); ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='10px monospace'; ctx.textAlign='center'; ctx.fillText('W',sx,sy+5+bob);
    }
    ctx.globalAlpha=1;
  }
}
// ---- Room ----
class Room {
  constructor(roomNum, isBossRoom) {
    this.roomNum=roomNum;
    this.isBossRoom=isBossRoom||false;
    this.cleared=false;
    this.grid=this.generateGrid();
    this.enemies=[];
    this.spawnEnemies();
    this.drops=[];
    this.doors={north:false,south:false,east:false,west:false};
    this.hasKeyDrop=false;
    this.enemySpawnTimer=0;
    this.maxEnemies=this.isBossRoom?1:8+Math.min(roomNum,8);
  }
  generateGrid() {
    // 0=floor, 1=wall, 2=obstacle
    const grid=[];
    for (let y=0;y<ROOM_H;y++) {
      grid[y]=[];
      for (let x=0;x<ROOM_W;x++) {
        if (x===0||y===0||x===ROOM_W-1||y===ROOM_H-1) grid[y][x]=1;
        else if (Math.random()<0.08&&x>1&&y>1&&x<ROOM_W-2&&y<ROOM_H-2) grid[y][x]=2;
        else grid[y][x]=0;
      }
    }
    // clear spawn area
    grid[6][8]=0; grid[6][9]=0; grid[7][8]=0; grid[7][9]=0;
    return grid;
  }
  spawnEnemies() {
    this.enemies=[];
    if (this.isBossRoom) {
      this.enemies.push(new BossEnemy(TILE*9,TILE*6,this.roomNum));
    } else {
      const count=4+Math.min(this.roomNum,6)+randInt(0,2);
      for (let i=0;i<count;i++) {
        let x,y,valid;
        let attempts=0;
        do {
          x=TILE*(1+randInt(1,ROOM_W-2)); y=TILE*(1+randInt(1,ROOM_H-2));
          valid=true;
          const tx=Math.floor(x/TILE), ty=Math.floor(y/TILE);
          if (this.grid[ty]&&this.grid[ty][tx]!==0) valid=false;
          if (Math.abs(x-TILE*9)<TILE*2&&Math.abs(y-TILE*6)<TILE*2) valid=false;
          for (const e of this.enemies) { if (dist({x,y},e)<60) valid=false; }
          attempts++;
        } while (!valid&&attempts<30);
        if (valid) {
          const type=this.pickEnemyType();
          let enemy;
          switch(type) {
            case 'slime': enemy=new SlimeEnemy(x,y,this.roomNum); break;
            case 'archer': enemy=new ArcherEnemy(x,y,this.roomNum); break;
            case 'big': enemy=new BigEnemy(x,y,this.roomNum); break;
            case 'shield': enemy=new ShieldEnemy(x,y,this.roomNum); break;
            case 'bat': enemy=new BatEnemy(x,y,this.roomNum); break;
            default: enemy=new SlimeEnemy(x,y,this.roomNum);
          }
          this.enemies.push(enemy);
        }
      }
    }
  }
  pickEnemyType() {
    const roll=Math.random();
    if (this.roomNum<2) return roll<0.6?'slime':'bat';
    if (this.roomNum<4) return roll<0.35?'slime':roll<0.6?'archer':roll<0.8?'bat':'big';
    return roll<0.25?'slime':roll<0.45?'archer':roll<0.6?'big':roll<0.8?'shield':'bat';
  }
  update(dt, player) {
    // update enemies
    let aliveCount=0;
    for (const enemy of this.enemies) {
      if (enemy.alive) {
        enemy.update(dt,player,this);
        aliveCount++;
      }
    }
    // check if room cleared
    if (aliveCount===0&&!this.cleared) {
      this.cleared=true;
      this.onClear(player);
    }
    // spawn more enemies if needed
    if (!this.cleared&&!this.isBossRoom&&aliveCount<this.maxEnemies&&this.enemies.length<20) {
      this.enemySpawnTimer-=dt;
      if (this.enemySpawnTimer<=0) {
        this.enemySpawnTimer=3+Math.random()*2;
        if (aliveCount<this.maxEnemies-2) {
          let x,y,valid;
          let attempts=0;
          do {
            x=TILE*(1+randInt(1,ROOM_W-2)); y=TILE*(1+randInt(1,ROOM_H-2));
            valid=true;
            const tx=Math.floor(x/TILE), ty=Math.floor(y/TILE);
            if (this.grid[ty]&&this.grid[ty][tx]!==0) valid=false;
            if (Math.abs(x-TILE*9)<TILE*2&&Math.abs(y-TILE*6)<TILE*2) valid=false;
            for (const e of this.enemies) { if (e.alive&&dist({x,y},e)<60) valid=false; }
            attempts++;
          } while (!valid&&attempts<20);
          if (valid) {
            const type=this.pickEnemyType();
            let enemy;
            switch(type) {
              case 'slime': enemy=new SlimeEnemy(x,y,this.roomNum); break;
              case 'archer': enemy=new ArcherEnemy(x,y,this.roomNum); break;
              case 'big': enemy=new BigEnemy(x,y,this.roomNum); break;
              case 'shield': enemy=new ShieldEnemy(x,y,this.roomNum); break;
              case 'bat': enemy=new BatEnemy(x,y,this.roomNum); break;
              default: enemy=new SlimeEnemy(x,y,this.roomNum);
            }
            this.enemies.push(enemy);
          }
        }
      }
    }
    // update drops
    for (const drop of this.drops) { if (drop.alive) drop.update(dt,player); }
    this.drops=this.drops.filter(d=>d.alive);
  }

  onClear(player) {
    // spawn loot
    const dropCount=2+randInt(0,2);
    for (let i=0;i<dropCount;i++) {
      let x=TILE*(6+randInt(2,10)), y=TILE*(4+randInt(2,8));
      const type=Math.random()<0.5?'gold':Math.random()<0.5?'hp':'shield';
      const val=type==='gold'?3+this.roomNum:type==='hp'?4:5;
      this.drops.push(new Drop(x,y,type,val));
    }
    // weapon drop
    if (Math.random()<0.2||this.roomNum%2===0) {
      this.drops.push(new Drop(TILE*9,TILE*6,'weapon',0));
    }
    // boss special drop
    if (this.isBossRoom) {
      for (let i=0;i<8;i++) this.drops.push(new Drop(TILE*(6+randInt(2,10)),TILE*(4+randInt(2,8)),'gold',10+this.roomNum*2));
      this.drops.push(new Drop(TILE*9,TILE*4,'weapon',0));
      this.drops.push(new Drop(TILE*9,TILE*8,'hp',10));
    }
    spawnExplosion(TILE*9,TILE*6,'#ffd54f',30,200,0.8);
  }
  draw(ctx, cam) {
    const startX=Math.max(0,Math.floor((cam.x)/TILE)-1);
    const endX=Math.min(ROOM_W-1,Math.ceil((cam.x+BASE_W)/TILE)+1);
    const startY=Math.max(0,Math.floor((cam.y)/TILE)-1);
    const endY=Math.min(ROOM_H-1,Math.ceil((cam.y+BASE_H)/TILE)+1);
    const screenMidX=BASE_W/2, screenMidY=BASE_H/2;

    for (let y=startY;y<=endY;y++) {
      for (let x=startX;x<=endX;x++) {
        const px=x*TILE-cam.x, py=y*TILE-cam.y;
        const tile=this.grid[y][x];
        if (tile===1) {
          ctx.fillStyle='#37474f';
          ctx.fillRect(px,py,TILE,TILE);
          ctx.fillStyle='#455a64';
          ctx.fillRect(px+1,py+1,TILE-2,TILE-2);
          // border highlight
          ctx.fillStyle='#546e7a';
          ctx.fillRect(px,py,TILE,2);
          ctx.fillRect(px,py,2,TILE);
        } else if (tile===2) {
          ctx.fillStyle='#4e342e';
          ctx.fillRect(px,py,TILE,TILE);
          ctx.fillStyle='#5d4037';
          ctx.fillRect(px+2,py+2,TILE-4,TILE-4);
          // crate detail
          ctx.strokeStyle='#3e2723'; ctx.lineWidth=1;
          ctx.strokeRect(px+4,py+4,TILE-8,TILE-8);
          ctx.beginPath(); ctx.moveTo(px+4,py+4); ctx.lineTo(px+TILE-4,py+TILE-4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(px+TILE-4,py+4); ctx.lineTo(px+4,py+TILE-4); ctx.stroke();
        } else {
          // floor tile with subtle pattern
          const shade=(x+y)%2===0?'#3a3a3a':'#333333';
          ctx.fillStyle=shade;
          ctx.fillRect(px,py,TILE,TILE);
        }
      }
    }
    // door indicators
    if (this.cleared) {
      ctx.fillStyle='rgba(255,215,0,0.6)';
      // north exit (top)
      ctx.fillRect(screenMidX-20,-cam.y+5,40,10);
      ctx.fillStyle='#ffd54f'; ctx.font='10px monospace'; ctx.textAlign='center';
      ctx.fillText('?'+'?',screenMidX,-cam.y+30);
    }

    // draw enemies
    for (const enemy of this.enemies) {
      if (enemy.alive) enemy.draw(ctx,cam);
    }
    // draw drops
    for (const drop of this.drops) { drop.draw(ctx,cam); }
  }
}
// ---- Game ----
class Game {
  constructor() {
    this.roomNum=1;
    this.player=new Player(TILE*9,TILE*6);
    this.player.weapons=['pistol'];
    this.player.weaponIdx=0;
    this.room=new Room(this.roomNum, false);
    this.camera={x:0,y:0};
    this.particles=[];
    this.enemyBullets=[];
    this.totalGold=0;
    this.waveCount=0;
    this.gameOver=false;
    this.started=true;
    this.transitionAlpha=0;
    this.transitionState='none'; // none, fadingOut, fadingIn
    this.transitionTimer=0;
    this.killCount=0;
    this.totalDamageDealt=0;
    this.shakeTimer=0;
    this.shakeIntensity=0;
  }
  update(dt) {
    if (this.gameOver||!this.started) return;
    // screen shake
    this.shakeTimer=Math.max(0,this.shakeTimer-dt);
    // camera follow
    const targetX=this.player.x-BASE_W/2;
    const targetY=this.player.y-BASE_H/2;
    this.camera.x=lerp(this.camera.x,targetX,0.1);
    this.camera.y=lerp(this.camera.y,targetY,0.1);
    // clamp
    this.camera.x=clamp(this.camera.x,0,ROOM_W*TILE-BASE_W);
    this.camera.y=clamp(this.camera.y,0,ROOM_H*TILE-BASE_H);
    // transition
    if (this.transitionState==='fadingOut') {
      this.transitionTimer-=dt;
      this.transitionAlpha=clamp(1-this.transitionTimer/0.5,0,1);
      if (this.transitionTimer<=0) {
        this.transitionState='fadingIn';
        this.transitionTimer=0.5;
        this.transitionAlpha=1;
        this.loadNextRoom();
      }
      return;
    }
    if (this.transitionState==='fadingIn') {
      this.transitionTimer-=dt;
      this.transitionAlpha=clamp(this.transitionTimer/0.5,0,1);
      if (this.transitionTimer<=0) { this.transitionState='none'; this.transitionAlpha=0; }
    }
    // update player
    this.player.update(dt);
    // check player death
    if (!this.player.alive) {
      this.gameOver=true;
      setTimeout(showGameOver, 500);
      return;
    }
    // wall collision
    this.resolveWallCollision(this.player);
    // update room
    this.room.update(dt, this.player);
    // update enemy bullets
    for (const b of this.enemyBullets) {
      b.update(dt);
      if (b.alive&&!b.isEnemy) continue;
      if (b.alive&&b.isEnemy) {
        // collision with player
        if (dist(b,this.player)<this.player.w/2+b.weapon.bulletSize) {
          this.player.takeDamage(b.damage);
          spawnHitEffect(b.x,b.y);
          b.alive=false;
          if (b.weapon.explosive) spawnExplosion(b.x,b.y,'#ff5722',20,200,0.4);
        }
      }
    }
    this.enemyBullets=this.enemyBullets.filter(b=>b.alive);
    // update player bullets and laser
    for (const b of this.player.bullets||[]) {
      b.update(dt);
      if (!b.alive) continue;
      // bullet-enemy collision
      const hitEnemy=this.findEnemyAt(b.x,b.y,b.weapon.bulletSize);
      if (hitEnemy) {
        const dmg=b.damage;
        hitEnemy.takeDamage(dmg);
        this.totalDamageDealt+=dmg;
        spawnHitEffect(b.x,b.y);
        if (b.weapon.knockback) {
          const a=angle(b,hitEnemy);
          hitEnemy.applyKnockback(Math.cos(a),Math.sin(a),b.weapon.knockback/20);
        }
        if (!b.weapon.pierce) b.alive=false;
        if (b.weapon.explosive) {
          spawnExplosion(b.x,b.y,'#ff5722',25,250,0.5);
          // explosion damage
          for (const e of this.room.enemies) {
            if (e.alive&&dist(e,b)<b.weapon.explosionRadius) {
              e.takeDamage(b.weapon.explosionDamage);
            }
          }
          b.alive=false;
        }
      }
    }
    this.player.bullets=(this.player.bullets||[]).filter(b=>b.alive);
    // update lasers
    for (const l of this.player.lasers||[]) {
      l.update(dt);
      if (l.alive) {
        // laser hit detection
        const steps=40;
        for (let s=0;s<=steps;s++) {
          const t=s/steps;
          const lx=l.x+Math.cos(l.angle)*l.range*t;
          const ly=l.y+Math.sin(l.angle)*l.range*t;
          const enemy=this.findEnemyAt(lx,ly,8);
          if (enemy&&!l.hitTargets.has(enemy)) {
            enemy.takeDamage(l.damage);
            this.totalDamageDealt+=l.damage;
            l.hitTargets.add(enemy);
            spawnHitEffect(lx,ly);
          }
          // wall
          const tx=Math.floor(lx/TILE), ty=Math.floor(ly/TILE);
          if (this.room.grid[ty]&&this.room.grid[ty][tx]===1) break;
        }
      }
    }
    this.player.lasers=(this.player.lasers||[]).filter(l=>l.alive);
    // check room transition (player near center when cleared)
    if (this.room.cleared) {
      const cx=TILE*9, cy=TILE*6;
      if (dist(this.player,{x:cx,y:cy})<TILE*2&&this.transitionState==='none') {
        // check for next room key press or auto
        if (keys['w']||keys['ArrowUp']||keys[' ']) {
          this.startTransition();
        }
      }
    }
    // update particles
    for (const p of this.particles) p.update(dt);
    this.particles=this.particles.filter(p=>p.life>0);
    // check enemy deaths for drops
    for (const enemy of this.room.enemies) {
      if (!enemy.alive&&!enemy._looted) {
        enemy._looted=true;
        this.killCount++;
        // small chance to drop
        if (Math.random()<0.2) {
          const type=Math.random()<0.5?'gold':Math.random()<0.5?'hp':'shield';
          const val=type==='gold'?1+randInt(0,2):type==='hp'?2:3;
          this.room.drops.push(new Drop(enemy.x,enemy.y,type,val));
        }
        // death explosion
        const colors={slime:'#66bb6a',archer:'#7e57c2',big:'#e65100',shield:'#546e7a',bat:'#4e342e',boss:'#ef5350'};
        spawnExplosion(enemy.x,enemy.y,colors[enemy.type]||'#fff',15,150,0.4);
      }
    }
  }
  findEnemyAt(x,y,radius) {
    for (const e of this.room.enemies) {
      if (e.alive&&dist(e,{x,y})<e.w/2+radius) return e;
    }
    return null;
  }

  resolveWallCollision(entity) {
    const margin=2;
    const halfW=entity.w/2||14;
    const halfH=entity.h/2||14;
    const left=Math.floor((entity.x-halfW-margin)/TILE);
    const right=Math.floor((entity.x+halfW+margin)/TILE);
    const top=Math.floor((entity.y-halfH-margin)/TILE);
    const bottom=Math.floor((entity.y+halfH+margin)/TILE);
    for (let ty=top;ty<=bottom;ty++) {
      for (let tx=left;tx<=right;tx++) {
        if (ty<0||ty>=ROOM_H||tx<0||tx>=ROOM_W) continue;
        const tile=this.room.grid[ty][tx];
        if (tile===0||tile===undefined) continue;
        const tcx=tx*TILE+TILE/2, tcy=ty*TILE+TILE/2;
        const dx=entity.x-tcx, dy=entity.y-tcy;
        const overlapX=halfW+TILE/2-Math.abs(dx);
        const overlapY=halfH+TILE/2-Math.abs(dy);
        if (overlapX>0&&overlapY>0) {
          if (overlapX<overlapY) entity.x+=Math.sign(dx)*overlapX;
          else entity.y+=Math.sign(dy)*overlapY;
        }
      }
    }
  }

  startTransition() {
    if (this.transitionState!=='none') return;
    this.transitionState='fadingOut';
    this.transitionTimer=0.5;
    this.transitionAlpha=0;
  }

  loadNextRoom() {
    this.roomNum++;
    const isBoss=this.roomNum%3===0;
    this.room=new Room(this.roomNum, isBoss);
    this.player.x=TILE*9; this.player.y=TILE*6;
    this.player.weapons=this.player.weapons.length>0?this.player.weapons:['pistol'];
    this.enemyBullets=[];
    this.player.bullets=[];
    this.player.lasers=[];
    this.particles=[];
  }
  spawnBullet(player, weapon, aimAngle) {
    if (weapon.isLaser) {
      if (!player.lasers) player.lasers=[];
      player.lasers.push(new LaserBeam(player.x,player.y,aimAngle,weapon,false));
      return;
    }
    if (!player.bullets) player.bullets=[];
    const spread=weapon.spread||0;
    for (let i=0;i<weapon.shots;i++) {
      const a=aimAngle+rand(-spread,spread);
      const sp=weapon.speed+rand(-30,30);
      const b=new Bullet(
        player.x+Math.cos(a)*18,
        player.y+Math.sin(a)*18,
        Math.cos(a)*sp, Math.sin(a)*sp,
        weapon.damage, weapon, false
      );
      player.bullets.push(b);
    }
    // muzzle flash
    for (let i=0;i<5;i++) {
      const a=aimAngle+rand(-0.5,0.5);
      this.particles.push(new Particle(
        player.x+Math.cos(aimAngle)*22,
        player.y+Math.sin(aimAngle)*22,
        Math.cos(a)*rand(50,150), Math.sin(a)*rand(50,150),
        rand(0.05,0.15),
        weapon.bulletColor, rand(2,4), 'circle'
      ));
    }
    // recoil
    player.knockbackVx-=Math.cos(aimAngle)*weapon.knockback*0.08;
    player.knockbackVy-=Math.sin(aimAngle)*weapon.knockback*0.08;
  }

  drawHUD(ctx) {
    const p=this.player;
    // HP bar
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(10,10,200,20);
    ctx.fillStyle='#ef5350'; ctx.fillRect(12,12,196*(p.hp/p.maxHp),16);
    ctx.fillStyle='#fff'; ctx.font='10px monospace';
    ctx.textAlign='left'; ctx.fillText('HP '+p.hp+'/'+p.maxHp,16,22);

    // Shield bar
    if (p.shield>0) {
      ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(10,34,140,12);
      ctx.fillStyle='#42a5f5'; ctx.fillRect(12,36,136*(p.shield/p.maxShield),8);
      ctx.fillStyle='#fff'; ctx.font='8px monospace';
      ctx.fillText('SHIELD '+p.shield+'/'+p.maxShield,14,42);
    }

    // Gold
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(10,50,80,16);
    ctx.fillStyle='#ffd54f'; ctx.font='10px monospace';
    ctx.fillText('GOLD: '+p.gold,14,62);

    // Weapon
    const wepName=p.getWeaponName();
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(10,70,140,16);
    ctx.fillStyle='#ce93d8'; ctx.font='10px monospace';
    ctx.textAlign='left'; ctx.fillText('['+wepName+']',14,82);

    // Room / Wave
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(BASE_W-110,10,100,20);
    ctx.fillStyle='#fff'; ctx.font='10px monospace'; ctx.textAlign='right';
    ctx.fillText('ROOM '+this.roomNum, BASE_W-14, 22);

    // Kills
    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(BASE_W-110,34,100,16);
    ctx.fillStyle='#81c784'; ctx.font='9px monospace'; ctx.textAlign='right';
    ctx.fillText('KILLS: '+this.killCount, BASE_W-14, 46);

    // Boss warning
    if (this.room.isBossRoom&&!this.room.cleared) {
      ctx.fillStyle='rgba(255,0,0,'+(0.3+0.3*Math.sin(Date.now()*0.005))+')';
      ctx.fillRect(0,BASE_H/2-20,BASE_W,40);
      ctx.fillStyle='#fff'; ctx.font='bold 20px monospace'; ctx.textAlign='center';
      ctx.fillText('!!! BOSS FIGHT !!!',BASE_W/2,BASE_H/2+6);
    }

    // Controls hint
    ctx.fillStyle='rgba(255,255,255,0.3)'; ctx.font='8px monospace'; ctx.textAlign='left';
    ctx.fillText('WASD移动 | 鼠标瞄准射击 | E翻滚 | R切枪', 10, BASE_H-8);

    // Next room hint
    if (this.room.cleared&&!this.room.isBossRoom) {
      ctx.fillStyle='rgba(255,215,0,'+(0.5+0.5*Math.sin(Date.now()*0.005))+')';
      ctx.font='12px monospace'; ctx.textAlign='center';
      ctx.fillText('按 W 或 空格 进入下一层', BASE_W/2, BASE_H/2-50);
    }
  }
  draw(ctx) {
    // screen shake
    ctx.save();
    if (this.shakeTimer>0) {
      const sx=(Math.random()-0.5)*this.shakeIntensity*2;
      const sy=(Math.random()-0.5)*this.shakeIntensity*2;
      ctx.translate(sx,sy);
    }

    // background
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(-10,-10,BASE_W+20,BASE_H+20);
    // debug border
    ctx.strokeStyle='#ff0000'; ctx.lineWidth=1;
    ctx.strokeRect(0,0,BASE_W,BASE_H);

    // draw room
    this.room.draw(ctx, this.camera);

    // draw drops
    for (const drop of this.room.drops) drop.draw(ctx,this.camera);

    // draw enemy bullets
    for (const b of this.enemyBullets) b.draw(ctx,this.camera);

    // draw player bullets
    for (const b of (this.player.bullets||[])) b.draw(ctx,this.camera);

    // draw lasers
    for (const l of (this.player.lasers||[])) l.draw(ctx,this.camera);

    // draw player
    if (this.player.alive) this.player.draw(ctx,this.camera);

    // draw particles
    for (const p of this.particles) p.draw(ctx,this.camera);

    ctx.restore();

    // mini-map
    this.drawMiniMap(ctx);

    // transition overlay
    if (this.transitionAlpha>0) {
      ctx.fillStyle='rgba(0,0,0,'+this.transitionAlpha+')';
      ctx.fillRect(0,0,BASE_W,BASE_H);
      if (this.transitionState==='fadingOut') {
        ctx.fillStyle='#fff'; ctx.font='16px monospace'; ctx.textAlign='center';
        ctx.fillText('ROOM '+this.roomNum+' -> ROOM '+(this.roomNum+1), BASE_W/2, BASE_H/2);
      } else if (this.transitionState==='fadingIn') {
        ctx.fillStyle='#fff'; ctx.font='16px monospace'; ctx.textAlign='center';
        const isBoss=(this.roomNum)%3===0;
        ctx.fillText(isBoss?'!!! BOSS ROOM !!!':'ROOM '+this.roomNum, BASE_W/2, BASE_H/2);
      }
    }

    // HUD
    this.drawHUD(ctx);

    // game over overlay
    if (this.gameOver) {
      ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(0,0,BASE_W,BASE_H);
      ctx.fillStyle='#ef5350'; ctx.font='bold 36px monospace'; ctx.textAlign='center';
      ctx.fillText('GAME OVER', BASE_W/2, BASE_H/2-40);
      ctx.fillStyle='#ffd54f'; ctx.font='16px monospace';
      ctx.fillText('最终金币: '+this.totalGold, BASE_W/2, BASE_H/2+10);
      ctx.fillText('击杀数: '+this.killCount, BASE_W/2, BASE_H/2+35);
      ctx.fillText('到达房间: '+this.roomNum, BASE_W/2, BASE_H/2+60);
      ctx.fillStyle='#fff'; ctx.font='12px monospace';
      ctx.fillText('点击"重新开始"再来一局', BASE_W/2, BASE_H/2+100);
    }
  }
  drawMiniMap(ctx) {
    const mmW=80, mmH=58;
    const mmX=BASE_W-mmW-10, mmY=BASE_H-mmH-10;
    const tileW=mmW/ROOM_W, tileH=mmH/ROOM_H;

    ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(mmX,mmY,mmW,mmH);
    ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1;
    ctx.strokeRect(mmX,mmY,mmW,mmH);

    for (let y=0;y<ROOM_H;y++) {
      for (let x=0;x<ROOM_W;x++) {
        const tile=this.room.grid[y][x];
        let color='transparent';
        if (tile===1) color='#455a64';
        else if (tile===2) color='#5d4037';
        else color='#1a1a1a';
        ctx.fillStyle=color; ctx.fillRect(mmX+x*tileW,mmY+y*tileH,tileW+0.5,tileH+0.5);
      }
    }

    // enemies on minimap
    ctx.fillStyle='#ef5350';
    for (const e of this.room.enemies) {
      if (e.alive) {
        ctx.fillRect(mmX+(e.x/TILE)*tileW-1,mmY+(e.y/TILE)*tileH-1,3,3);
      }
    }
    // player on minimap
    ctx.fillStyle='#42a5f5';
    const px=mmX+(this.player.x/TILE)*tileW;
    const py=mmY+(this.player.y/TILE)*tileH;
    ctx.beginPath(); ctx.arc(px,py,2.5,0,Math.PI*2); ctx.fill();

    // room cleared indicator
    if (this.room.cleared) {
      ctx.fillStyle='rgba(255,215,0,0.5)';
      ctx.fillRect(mmX+tileW*8,mmY+tileH*6-2,tileW*2,4);
    }
  }
}
// ---- Game Loop ----
let lastTime=0;

function gameLoop(timestamp) {
  const dt=Math.min((timestamp-lastTime)/1000, 0.05);
  lastTime=timestamp;

  if (game&&game.started) {
    game.update(dt);
    game.draw(ctx);
  }

  if (gameRunning) {
    gameLoopId=requestAnimationFrame(gameLoop);
  }
}

function startGame() {
  document.getElementById('startScreen').style.display='none';
  document.getElementById('gameOverScreen').style.display='none';
  game=new Game();
  game.started=true;
  gameRunning=true;
  lastTime=performance.now();
  if (gameLoopId) cancelAnimationFrame(gameLoopId);
  gameLoopId=requestAnimationFrame(gameLoop);
}

function restartGame() {
  if (gameLoopId) cancelAnimationFrame(gameLoopId);
  gameRunning=false;
  const goScreen=document.getElementById('gameOverScreen');
  goScreen.style.display='none';
  goScreen.classList.add('hidden');
  startGame();
}

function showGameOver() {
  const goScreen=document.getElementById('gameOverScreen');
  goScreen.classList.remove('hidden');
  goScreen.style.display='flex';
  document.getElementById('statRooms').textContent=game.roomNum;
  document.getElementById('statKills').textContent=game.killCount;
  document.getElementById('statCoins').textContent=game.totalGold;
}

function showStartScreen() {
  document.getElementById('startScreen').style.display='flex';
  document.getElementById('gameContainer').style.display='none';
  document.getElementById('gameOverScreen').style.display='none';
}

// Expose to HTML
window.startGame=startGame;
window.restartGame=restartGame;
window.showGameOver=showGameOver;

// Draw initial frame on canvas (before game starts)
ctx.fillStyle='#1a1a1a';
ctx.fillRect(0,0,BASE_W,BASE_H);
ctx.fillStyle='#333'; ctx.font='16px monospace'; ctx.textAlign='center';
ctx.fillText('元气骑士 · 加载中...', BASE_W/2, BASE_H/2);

console.log('元气骑士 (Soul Knight) loaded!');
// fix the drop bug in previous write
// (shield particle loop fix applied via edit)
