import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
const {createHider}=createRequire(import.meta.url)('../promotions.js');
const setup=html=>{const dom=new JSDOM(html);return {dom,document:dom.window.document,hide:createHider(dom.window.document)};};
const hidden=element=>element.style.getPropertyValue('display')==='none'&&element.style.getPropertyPriority('display')==='important';

test('hides header Get Pro and its dedicated wrapper while retaining neighboring navigation',()=>{
 const f=setup('<nav><a id="saved">Saved</a><div id="wrapper"><button id="pro"><span>Get Pro</span></button></div><button id="menu">Menu</button></nav>');f.hide();
 assert(hidden(f.document.querySelector('#pro')));assert(hidden(f.document.querySelector('#wrapper')));
 assert(!hidden(f.document.querySelector('nav')));assert(!hidden(f.document.querySelector('#saved')));assert(!hidden(f.document.querySelector('#menu')));
});
test('hides the observed inline banner including PRO badge and varying app counts',()=>{
 for(const number of ['100','1,000','1,500']){const f=setup(`<aside id="promo"><div><span>PRO</span><span>Upgrade for full access to Midjourney and ${number} other apps and sites — <button>Get Pro</button></span></div></aside><h1 id="app">Midjourney</h1>`);f.hide();assert(hidden(f.document.querySelector('#promo')));assert(!hidden(f.document.querySelector('#app')));}
});
test('retains legacy banner support and leaves unrelated sidebars, screenshot cards and account actions intact',()=>{
 const f=setup('<aside id="legacy"><h1>Access all 709,616 screens.</h1><button>Get Pro</button></aside><aside id="help"><h2>Help</h2><button>Support</button></aside><aside id="screen"><img alt="Checkout screen"><p>Upgrade for full access to Checkout and 100 other apps and sites</p><button>Get Pro</button><button id="save">Save</button></aside><button id="download">Upgrade to download all screens</button>');f.hide();
 assert(hidden(f.document.querySelector('#legacy')));assert(!hidden(f.document.querySelector('#help')));assert(!hidden(f.document.querySelector('#screen')));assert(!hidden(f.document.querySelector('#save')));assert(!hidden(f.document.querySelector('#download')));
});
test('restores recycled actions and banners without overriding later page styles',()=>{
 const f=setup('<div id="wrapper" style="display:inline-flex"><button id="pro" style="display:inline-block">Get Pro</button></div><aside id="promo"><span>Upgrade for full access to App and 100 other apps and sites</span><button>Get Pro</button></aside>');f.hide();
 const button=f.document.querySelector('#pro');button.textContent='Save';f.hide();assert.equal(button.style.display,'inline-block');assert.equal(f.document.querySelector('#wrapper').style.display,'inline-flex');
 f.document.querySelector('#promo').innerHTML='<p>Helpful information</p>';f.hide();assert.equal(f.document.querySelector('#promo').style.display,'');
 button.textContent='Get Pro';f.hide();button.style.setProperty('display','flex');button.textContent='Copy';f.hide();assert.equal(button.style.display,'flex');
});
test('handles later insertions and whitespace without repeat mutations or detached-node retention',()=>{
 const f=setup('<main id="page"></main>');f.hide();f.document.querySelector('#page').innerHTML='<button id="pro"> Get\n Pro </button>';
 f.hide();assert(hidden(f.document.querySelector('#pro')));
 const observer=new f.dom.window.MutationObserver(()=>{});observer.observe(f.document,{subtree:true,attributes:true});f.hide();assert.equal(observer.takeRecords().length,0);observer.disconnect();
 f.document.querySelector('#pro').remove();f.hide();assert(!hidden(f.document.querySelector('main')));
});
