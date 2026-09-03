// user.js — Knowbit logged-in experience.
// Every button here performs a real Firestore read/write. If nobody is
// signed in, this page bounces back to index.html.

import {
  auth, db, googleProvider,
  signOut, onAuthStateChanged, updateProfile,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  query, where, orderBy, limit, getDocs, serverTimestamp, increment, writeBatch
} from "./firebase-config.js";

/* ============================== helpers ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str = ""){
  return String(str).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function initials(name = "?"){
  return name.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || "").join("") || "?";
}
function avatarHtml(user = {}, size = ""){
  const cls = "avatar" + (size ? ` avatar-${size}` : "");
  if (user.avatarBase64) return `<div class="${cls}"><img src="${user.avatarBase64}" alt=""></div>`;
  return `<div class="${cls}">${initials(user.name || user.username || "?")}</div>`;
}
function timeAgo(ts){
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function readingTime(text = ""){
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
function slugify(title = ""){
  return title.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60) + "-" + Math.random().toString(36).slice(2,7);
}
function paragraphsToHtml(text = ""){
  return text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}
function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-shown"), 2200);
}

const TOPICS = ["Technology","Education","Science","Business","Programming","Productivity","History","Career","Finance"];

/* ============================== modal / sheet / confirm ============================== */

function openModal(html){
  $("#modalBox").innerHTML = html;
  $("#modalLayer").classList.remove("hidden");
  $("#modalLayer").setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
function closeModal(){
  $("#modalLayer").classList.add("hidden");
  $("#modalLayer").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}
$("#modalLayer").addEventListener("click", e => { if (e.target.matches("[data-close-modal]")) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

function confirmDialog({ title, body, confirmLabel = "Delete", danger = true, onConfirm }){
  openModal(`
    <div class="confirm-box">
      <div class="confirm-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4M12 17h.01M10.3 3.9 2.6 17.5A1.8 1.8 0 0 0 4.2 20h15.6a1.8 1.8 0 0 0 1.6-2.5L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>
      </div>
      <h2 class="modal-title">${escapeHtml(title)}</h2>
      <p class="modal-sub">${escapeHtml(body)}</p>
      <div class="confirm-actions">
        <button class="btn btn-subtle" data-close-modal>Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmYes">${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `);
  $("#confirmYes").addEventListener("click", async () => { closeModal(); await onConfirm(); });
}

function openSheet(actionsHtml, title){
  openModal(`
    ${title ? `<h2 class="modal-title" style="margin-bottom:10px;">${escapeHtml(title)}</h2>` : ""}
    <div>${actionsHtml}</div>
  `);
}

function reportDialog(targetType, targetId){
  const reasons = ["Spam","Harassment","Hate","Misleading content","Copyright concern","Other"];
  openModal(`
    <button class="iconbtn modal-close" data-close-modal aria-label="Close">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <h2 class="modal-title">Report ${escapeHtml(targetType)}</h2>
    <p class="modal-sub">Help us understand what's wrong.</p>
    <div id="reportReasons">
      ${reasons.map(r => `<button class="listcard" style="width:100%;border:1px solid var(--line);border-radius:var(--radius-m);padding:12px 14px;margin-bottom:8px;" data-reason="${r}">${r}</button>`).join("")}
    </div>
  `);
  $$("#reportReasons [data-reason]").forEach(btn => btn.addEventListener("click", async () => {
    await addDoc(collection(db, "reports"), {
      reporterId: me.uid, targetType, targetId, reason: btn.dataset.reason, status: "pending", createdAt: serverTimestamp()
    });
    closeModal();
    toast("Report submitted — thank you");
  }));
}

/* ============================== auth state ============================== */

let me = null;      // firebase auth user
let meDoc = null;    // firestore users/{uid} data
let myLikes = new Set();
let myBookmarks = new Set();
let myFollowing = new Set();

onAuthStateChanged(auth, async user => {
  if (!user){
    $("#authGate").style.display = "block";
    setTimeout(() => { window.location.href = "index.html"; }, 900);
    return;
  }
  me = user;
  const snap = await getDoc(doc(db, "users", me.uid));
  meDoc = snap.exists() ? snap.data() : { name: me.displayName || "You", username: "you", role: "user" };

  if (meDoc.role === "admin"){
    // Admin accounts get the admin console instead of the writer experience.
    window.location.href = "admin.html";
    return;
  }

  paintHeaderIdentity();
  await Promise.all([loadMyLikes(), loadMyBookmarks(), loadMyFollowing()]);
  renderRailTopics();
  router();
});

function paintHeaderIdentity(){
  $("#headerAvatar").innerHTML = avatarHtml(meDoc);
  $("#railAvatar").innerHTML = avatarHtml(meDoc);
  $("#railName").textContent = meDoc.name || "You";
  $("#railHandle").textContent = "@" + (meDoc.username || "");
}

async function loadMyLikes(){
  const q = query(collection(db, "likes"), where("userId", "==", me.uid));
  const snap = await getDocs(q);
  myLikes = new Set(snap.docs.map(d => d.data().postId));
}
async function loadMyBookmarks(){
  const q = query(collection(db, "bookmarks"), where("userId", "==", me.uid));
  const snap = await getDocs(q);
  myBookmarks = new Set(snap.docs.map(d => d.data().postId));
}
async function loadMyFollowing(){
  const q = query(collection(db, "follows"), where("followerId", "==", me.uid));
  const snap = await getDocs(q);
  myFollowing = new Set(snap.docs.map(d => d.data().followingId));
}

/* ============================== header interactions ============================== */

function toggleDropdown(id, others = []){
  others.forEach(o => $(o).classList.add("hidden"));
  $(id).classList.toggle("hidden");
}
document.addEventListener("click", e => {
  if (!e.target.closest("#profileMenuWrap")) $("#profileDropdown").classList.add("hidden");
  if (!e.target.closest("#notifWrap")) $("#notifDropdown").classList.add("hidden");
});

$("#profileMenuBtn").addEventListener("click", ev => {
  ev.stopPropagation();
  $("#profileDropdown").innerHTML = `
    <button class="dropdown-item" data-nav="#/profile">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8.5" r="3.4"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg> View profile
    </button>
    <button class="dropdown-item" data-nav="#/my-posts">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8"/></svg> My posts
    </button>
    <button class="dropdown-item" data-nav="#/analytics">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 19V9m6.5 10V4M18 19v-6"/></svg> Analytics
    </button>
    <button class="dropdown-item" data-nav="#/settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/></svg> Settings
    </button>
    <div class="dropdown-sep"></div>
    <button class="dropdown-item danger" id="logoutBtn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 4H5v16h4M16 12H9m7 0-3-3m3 3-3 3"/></svg> Log out
    </button>
  `;
  $$("#profileDropdown [data-nav]").forEach(b => b.addEventListener("click", () => { location.hash = b.dataset.nav; $("#profileDropdown").classList.add("hidden"); }));
  $("#logoutBtn").addEventListener("click", async () => { await signOut(auth); window.location.href = "index.html"; });
  toggleDropdown("#profileDropdown", ["#notifDropdown"]);
});

$("#notifBtn").addEventListener("click", async ev => {
  ev.stopPropagation();
  toggleDropdown("#notifDropdown", ["#profileDropdown"]);
  if (!$("#notifDropdown").classList.contains("hidden")) await paintNotifDropdown();
});

async function fetchMyNotifications(max = 30){
  const q = query(collection(db, "notifications"), where("userId", "==", me.uid), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function notifIcon(type){
  const paths = {
    like: '<path d="M12 20s-7.5-4.6-9.8-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.8 5c-2.3 4.4-9.8 9-9.8 9Z"/>',
    comment: '<path d="M4 5h16v11H8l-4 4V5Z"/>',
    reply: '<path d="M9 10 4 15l5 5M4 15h11a5 5 0 0 0 5-5V6"/>',
    follow: '<circle cx="9" cy="8" r="3"/><path d="M2 20a7 7 0 0 1 14 0M17 8v6M14 11h6"/>',
    published: '<path d="m5 13 4 4L19 7"/>',
    featured: '<path d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.2L12 16.9 6.4 20l1.4-6.2L3 9.5l6.4-.6Z"/>',
    admin: '<path d="M12 3 4 6v6c0 4.5 3.2 7.4 8 9 4.8-1.6 8-4.5 8-9V6Z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${paths[type] || paths.like}</svg>`;
}
function notifText(n){
  const name = `<b>${escapeHtml(n.fromUserName || "Someone")}</b>`;
  switch(n.type){
    case "like": return `${name} liked your post`;
    case "comment": return `${name} commented on your post`;
    case "reply": return `${name} replied to your comment`;
    case "follow": return `${name} started following you`;
    case "published": return `Your post was published successfully`;
    case "featured": return `Your post was featured on Knowbit`;
    case "admin": return escapeHtml(n.message || "Announcement from Knowbit");
    default: return escapeHtml(n.message || "New activity on Knowbit");
  }
}

async function paintNotifDropdown(){
  const dd = $("#notifDropdown");
  dd.innerHTML = `<div style="padding:8px 4px;"><div class="skeleton" style="height:14px;width:60%;margin-bottom:10px;"></div><div class="skeleton" style="height:14px;width:80%;"></div></div>`;
  const items = await fetchMyNotifications(8);
  updateNotifBadge(items);
  dd.innerHTML = items.length ? items.map(n => `
    <button class="dropdown-item" style="align-items:flex-start;height:auto;" data-notif="${n.id}" data-post="${n.postId||""}">
      <span class="notif-icon">${notifIcon(n.type)}</span>
      <span style="text-align:left;">
        <span class="notif-text" style="display:block;">${notifText(n)}</span>
        <span class="notif-time">${timeAgo(n.createdAt)}</span>
      </span>
    </button>`).join("") : `<p style="padding:14px;text-align:center;font-size:13.5px;color:var(--faint);">No notifications yet</p>`;
  $$("[data-notif]", dd).forEach(el => el.addEventListener("click", async () => {
    await updateDoc(doc(db, "notifications", el.dataset.notif), { read: true }).catch(()=>{});
    dd.classList.add("hidden");
    if (el.dataset.post) location.hash = "#/post/" + el.dataset.post;
    else location.hash = "#/notifications";
  }));
}
function updateNotifBadge(items){
  const unread = items.filter(n => !n.read).length;
  const badge = $("#notifBadge");
  if (unread > 0){ badge.textContent = unread > 9 ? "9+" : unread; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

function goWrite(){ location.hash = "#/write"; }
$("#writeBtn").addEventListener("click", goWrite);
$("#railWriteBtn").addEventListener("click", goWrite);
$("#bottomWriteBtn").addEventListener("click", goWrite);

$("#searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const term = $("#searchInput").value.trim();
  if (term) location.hash = "#/search/" + encodeURIComponent(term);
});

/* ============================== data layer: posts ============================== */

async function fetchPublishedPosts(field = "createdAt", max = 20){
  const q = query(collection(db, "posts"), where("status", "==", "published"), orderBy(field, "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fetchAuthorsFor(posts){
  const ids = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
  const out = {};
  await Promise.all(ids.map(async uid => {
    const s = await getDoc(doc(db, "users", uid));
    if (s.exists()) out[uid] = { id: uid, ...s.data() };
  }));
  return out;
}
async function fetchFollowingPosts(max = 30){
  if (!myFollowing.size) return [];
  const ids = [...myFollowing].slice(0, 10); // Firestore 'in' cap
  const q = query(collection(db, "posts"), where("authorId", "in", ids), where("status", "==", "published"), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fetchPostBySlug(slug){
  const q = query(collection(db, "posts"), where("slug", "==", slug), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty){
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
  }
  const direct = await getDoc(doc(db, "posts", slug)).catch(() => null);
  return direct && direct.exists() ? { id: direct.id, ...direct.data() } : null;
}
}
async function fetchPostsByAuthor(authorId, status, max = 40){
  const clauses = [where("authorId", "==", authorId)];
  if (status) clauses.push(where("status", "==", status));
  const q = query(collection(db, "posts"), ...clauses, orderBy("updatedAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fetchUserByUsername(username){
  const q = query(collection(db, "users"), where("username", "==", username), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
async function fetchTopWriters(max = 5){
  const q = query(collection(db, "users"), orderBy("followerCount", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== me.uid);
}

/* ---------- likes / bookmarks / follows (writes) ---------- */

async function toggleLike(postId, authorId, btn){
  const liking = !myLikes.has(postId);
  btn.classList.toggle("is-liked", liking);
  const countEl = btn.querySelector(".count");
  if (countEl) countEl.textContent = Number(countEl.textContent || 0) + (liking ? 1 : -1);

  const likeRef = doc(db, "likes", `${postId}_${me.uid}`);
  try{
    if (liking){
      await setDoc(likeRef, { postId, userId: me.uid, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "posts", postId), { likeCount: increment(1) });
      myLikes.add(postId);
      if (authorId && authorId !== me.uid){
        await addDoc(collection(db, "notifications"), {
          userId: authorId, type: "like", fromUserId: me.uid, fromUserName: meDoc.name, postId, read: false, createdAt: serverTimestamp()
        });
      }
    } else {
      await deleteDoc(likeRef);
      await updateDoc(doc(db, "posts", postId), { likeCount: increment(-1) });
      myLikes.delete(postId);
    }
  }catch(err){ console.error(err); toast("Couldn't update like"); }
}

async function toggleBookmark(postId, btn){
  const saving = !myBookmarks.has(postId);
  btn.classList.toggle("is-saved", saving);
  const bmRef = doc(db, "bookmarks", `${me.uid}_${postId}`);
  try{
    if (saving){
      await setDoc(bmRef, { userId: me.uid, postId, createdAt: serverTimestamp() });
      myBookmarks.add(postId);
      toast("Saved to bookmarks");
    } else {
      await deleteDoc(bmRef);
      myBookmarks.delete(postId);
      toast("Removed from bookmarks");
    }
  }catch(err){ console.error(err); toast("Couldn't update bookmark"); }
}

async function toggleFollow(targetId, btn){
  if (targetId === me.uid) return;
  const following = !myFollowing.has(targetId);
  btn.textContent = following ? "Following" : "Follow";
  btn.classList.toggle("is-following", following);

  const followRef = doc(db, "follows", `${me.uid}_${targetId}`);
  try{
    if (following){
      await setDoc(followRef, { followerId: me.uid, followingId: targetId, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "users", targetId), { followerCount: increment(1) });
      await updateDoc(doc(db, "users", me.uid), { followingCount: increment(1) });
      myFollowing.add(targetId);
      await addDoc(collection(db, "notifications"), {
        userId: targetId, type: "follow", fromUserId: me.uid, fromUserName: meDoc.name, read: false, createdAt: serverTimestamp()
      });
    } else {
      await deleteDoc(followRef);
      await updateDoc(doc(db, "users", targetId), { followerCount: increment(-1) });
      await updateDoc(doc(db, "users", me.uid), { followingCount: increment(-1) });
      myFollowing.delete(targetId);
    }
  }catch(err){ console.error(err); toast("Couldn't update follow"); }
}

/* ============================== post card (shared) ============================== */

function postCardHtml(post, author = {}, opts = {}){
  const title = escapeHtml(post.title || "Untitled");
  const excerpt = escapeHtml((post.content || "").replace(/\n+/g, " ")).slice(0, 180);
  const mins = post.readingTime || readingTime(post.content || "");
  const liked = myLikes.has(post.id);
  const saved = myBookmarks.has(post.id);
  return `
  <article class="postcard" data-post-id="${post.id}">
    <div class="postcard-head">
      <div class="postcard-byline">
        ${avatarHtml(author)}
        <div>
          <div class="byline-name">${escapeHtml(author.name || "Unknown writer")}</div>
          <div class="byline-meta">
            <a href="#/@${escapeHtml(author.username || "")}">@${escapeHtml(author.username || "unknown")}</a>
            &middot; ${timeAgo(post.createdAt)}
            ${post.topic ? `&middot; <span class="topic-chip">${escapeHtml(post.topic)}</span>` : ""}
          </div>
        </div>
      </div>
      ${opts.ownerMenu ? `
      <button class="iconbtn postcard-more" data-more="${post.id}" aria-label="More options">
        <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>
      </button>` : ""}
    </div>
    <h3 class="postcard-title"><a href="#/post/${encodeURIComponent(post.slug || post.id)}">${title}</a></h3>
    <p class="postcard-excerpt">${excerpt}${excerpt.length >= 180 ? "…" : ""}</p>
    <div class="postcard-foot">
      <button class="postcard-stat ${liked ? "is-liked" : ""}" data-like="${post.id}" data-author="${post.authorId||""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20s-7.5-4.6-9.8-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.8 5c-2.3 4.4-9.8 9-9.8 9Z"/></svg>
        <span class="count">${post.likeCount || 0}</span>
      </button>
      <a class="postcard-stat" href="#/post/${encodeURIComponent(post.slug || post.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>
        ${post.commentCount || 0}
      </a>
      <button class="postcard-stat ${saved ? "is-saved" : ""}" data-bookmark="${post.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
      </button>
      <button class="postcard-stat" data-share="${escapeHtml(post.slug || post.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7 15.9 6.3M8.1 13.3l7.8 4.4"/></svg>
      </button>
      <span class="postcard-time">${mins} min read</span>
    </div>
  </article>`;
}

function wirePostCardEvents(root){
  $$("[data-like]", root).forEach(btn => btn.addEventListener("click", () => toggleLike(btn.dataset.like, btn.dataset.author, btn)));
  $$("[data-bookmark]", root).forEach(btn => btn.addEventListener("click", () => toggleBookmark(btn.dataset.bookmark, btn)));
  $$("[data-share]", root).forEach(btn => btn.addEventListener("click", () => {
    const url = `${location.origin}${location.pathname.replace("user.html","index.html")}#/post/${btn.dataset.share}`;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied")).catch(() => toast(url));
  }));
  $$("[data-more]", root).forEach(btn => btn.addEventListener("click", () => openPostMenu(btn.dataset.more)));
}

function openPostMenu(postId){
  openSheet(`
    <button class="sheet-action" id="menuEdit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/></svg> Edit post</button>
    <button class="sheet-action" id="menuShare"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7 15.9 6.3M8.1 13.3l7.8 4.4"/></svg> Share</button>
    <button class="sheet-action danger" id="menuDelete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg> Delete post</button>
  `);
  $("#menuEdit").addEventListener("click", () => { closeModal(); location.hash = "#/write/" + postId; });
  $("#menuShare").addEventListener("click", async () => {
    closeModal();
    const url = `${location.origin}${location.pathname.replace("user.html","index.html")}#/post/${postId}`;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied"));
  });
  $("#menuDelete").addEventListener("click", () => {
    confirmDialog({
      title: "Delete this post?",
      body: "This can't be undone. The post will be removed for everyone.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        await deleteDoc(doc(db, "posts", postId));
        await updateDoc(doc(db, "users", me.uid), { postCount: increment(-1) }).catch(()=>{});
        toast("Post deleted");
        router();
      }
    });
  });
}

function skeletonCards(n){
  return Array.from({length:n}).map(() => `
    <div class="postcard">
      <div class="postcard-byline">
        <div class="skeleton" style="width:30px;height:30px;border-radius:999px;"></div>
        <div style="flex:1;"><div class="skeleton" style="width:120px;height:12px;margin-bottom:6px;"></div><div class="skeleton" style="width:80px;height:10px;"></div></div>
      </div>
      <div class="skeleton" style="width:80%;height:22px;margin-bottom:8px;"></div>
      <div class="skeleton" style="width:100%;height:14px;margin-bottom:6px;"></div>
    </div>`).join("");
}
function skeletonRows(n){
  return Array.from({length:n}).map(() => `
    <div class="widget-row"><div class="skeleton" style="width:30px;height:30px;border-radius:999px;"></div><div style="flex:1;"><div class="skeleton" style="width:70%;height:12px;"></div></div></div>`).join("");
}
function emptyState(title, body){
  return `<div class="empty"><p class="empty-title">${escapeHtml(title)}</p><p class="empty-body">${escapeHtml(body)}</p></div>`;
}
function errorState(){ return emptyState("Something went wrong", "Please try again in a moment."); }

/* ============================== pages ============================== */

async function renderHome(){
  const content = $("#content");
  content.innerHTML = `
    <div class="tabs" role="tablist">
      <button class="tab is-active" data-tab="foryou">For You</button>
      <button class="tab" data-tab="following">Following</button>
      <button class="tab" data-tab="latest">Latest</button>
    </div>
    <div id="feedList">${skeletonCards(4)}</div>
  `;
  let allPosts = [];
  try{ allPosts = await fetchPublishedPosts("createdAt", 25); }
  catch(err){ console.error(err); $("#feedList").innerHTML = errorState(); return; }
  const authors = await fetchAuthorsFor(allPosts);
  paintFeed(allPosts, authors);
  renderSidebar();

  $$(".tab", content).forEach(tab => tab.addEventListener("click", async () => {
    $$(".tab", content).forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    $("#feedList").innerHTML = skeletonCards(3);
    if (tab.dataset.tab === "following"){
      const posts = await fetchFollowingPosts(30).catch(() => []);
      const a = await fetchAuthorsFor(posts);
      if (!posts.length){ $("#feedList").innerHTML = emptyState("Follow some writers", "Posts from people you follow will show up here."); return; }
      paintFeed(posts, a);
    } else if (tab.dataset.tab === "latest"){
      paintFeed([...allPosts].sort((a,b) => (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)), authors);
    } else {
      paintFeed([...allPosts].sort((a,b) => (b.likeCount||0)-(a.likeCount||0)), authors);
    }
  }));
}
function paintFeed(posts, authors){
  const list = $("#feedList");
  if (!posts.length){ list.innerHTML = emptyState("No posts yet", "When writers publish, their posts show up here."); return; }
  list.innerHTML = posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("");
  wirePostCardEvents(list);
}

async function renderSidebar(){
  const side = $("#side");
  side.innerHTML = `
    <div class="widget"><div class="widget-head"><span class="widget-title">Who to follow</span></div><div id="topWritersList">${skeletonRows(3)}</div></div>
    <div class="widget"><div class="widget-head"><span class="widget-title">Trending topics</span></div>
      ${TOPICS.slice(0,5).map(t => `<div class="widget-row"><div style="flex:1;"><div class="widget-row-name">#${t}</div></div></div>`).join("")}
    </div>`;
  try{
    const writers = await fetchTopWriters(4);
    $("#topWritersList").innerHTML = writers.length ? writers.map(w => `
      <div class="widget-row">
        ${avatarHtml(w)}
        <div style="flex:1;min-width:0;"><div class="widget-row-name">${escapeHtml(w.name||"")}</div><div class="widget-row-meta">${w.followerCount||0} followers</div></div>
        <button class="btn btn-subtle btn-sm follow-btn ${myFollowing.has(w.id)?"is-following":""}" data-follow="${w.id}">${myFollowing.has(w.id)?"Following":"Follow"}</button>
      </div>`).join("") : `<p class="widget-row-meta">Nobody to show yet.</p>`;
    $$("[data-follow]", $("#topWritersList")).forEach(b => b.addEventListener("click", () => toggleFollow(b.dataset.follow, b)));
  }catch{ $("#topWritersList").innerHTML = `<p class="widget-row-meta">Couldn't load.</p>`; }
}

async function renderExplore(){
  const content = $("#content");
  content.innerHTML = `
    <h1 class="page-title">Explore</h1>
    <p class="page-sub">Trending topics, popular writers and the latest ideas on Knowbit.</p>
    <h2 class="section-title">Topics</h2>
    <div class="chip-grid">${TOPICS.map(t => `<a href="#/" class="topic-card"><div class="topic-card-name">${t}</div><div class="topic-card-meta">Explore posts</div></a>`).join("")}</div>
    <h2 class="section-title">Popular writers</h2>
    <div class="people-grid" id="explorePeople">${skeletonRows(4)}</div>
    <h2 class="section-title">Latest posts</h2>
    <div id="exploreFeed">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  try{
    const [writers, posts] = await Promise.all([fetchTopWriters(6), fetchPublishedPosts("createdAt", 10)]);
    $("#explorePeople").innerHTML = writers.length ? writers.map(w => `
      <div class="person-card">
        ${avatarHtml(w, "lg")}
        <div class="person-card-body">
          <div class="person-card-name">${escapeHtml(w.name||"")}</div>
          <div class="person-card-handle">@${escapeHtml(w.username||"")}</div>
          <p class="person-card-bio">${escapeHtml(w.bio||"")}</p>
          <button class="btn btn-subtle btn-sm follow-btn ${myFollowing.has(w.id)?"is-following":""}" data-follow="${w.id}">${myFollowing.has(w.id)?"Following":"Follow"}</button>
        </div>
      </div>`).join("") : emptyState("No writers yet", "Be the first to join and publish.");
    $$("[data-follow]", $("#explorePeople")).forEach(b => b.addEventListener("click", () => toggleFollow(b.dataset.follow, b)));

    const authors = await fetchAuthorsFor(posts);
    $("#exploreFeed").innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No posts yet", "Check back soon.");
    wirePostCardEvents($("#exploreFeed"));
  }catch(err){ console.error(err); $("#explorePeople").innerHTML = errorState(); }
}

/* ---------- Writer ---------- */

let writerDraftId = null;
let writerSelectedTopic = "";

function insertAtCursor(textarea, before, after = ""){
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const val = textarea.value;
  const selected = val.slice(start, end) || "text";
  textarea.value = val.slice(0, start) + before + selected + after + val.slice(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
  textarea.dispatchEvent(new Event("input"));
}

async function renderWriter(postId){
  const content = $("#content");
  writerDraftId = postId || null;
  writerSelectedTopic = "";
  let existing = null;
  if (postId){
    const s = await getDoc(doc(db, "posts", postId));
    if (s.exists()) existing = { id: s.id, ...s.data() };
  }
  writerSelectedTopic = existing?.topic || "";

  content.innerHTML = `
    <div class="writer-topbar">
      <span class="page-title" style="font-size:19px;">${existing ? "Edit post" : "Write a new post"}</span>
      <div class="writer-topbar-actions">
        <button class="btn btn-subtle btn-sm" id="previewBtn" type="button">Preview</button>
        <button class="btn btn-subtle btn-sm" id="saveDraftBtn" type="button">Save Draft</button>
        <button class="btn btn-primary btn-sm" id="publishBtn" type="button">Publish</button>
      </div>
    </div>
    <p class="writer-error hidden" id="writerError"></p>
    <input id="writerTitle" class="writer-title-input" placeholder="Your title" value="${existing ? escapeHtml(existing.title||"") : ""}">
    <div class="topic-select-row" id="topicRow">
      ${TOPICS.map(t => `<button type="button" class="topic-pill ${t===writerSelectedTopic?"is-selected":""}" data-topic="${t}">${t}</button>`).join("")}
    </div>
    <div class="editor-toolbar">
      <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
      <button type="button" data-cmd="h2" title="Heading">H</button>
      <button type="button" data-cmd="quote" title="Quote">&rdquo;</button>
      <button type="button" data-cmd="ul" title="Bulleted list">&bull; L</button>
      <button type="button" data-cmd="ol" title="Numbered list">1.</button>
      <button type="button" data-cmd="link" title="Link">&#128279;</button>
    </div>
    <textarea id="writerBody" class="writer-textarea" placeholder="Write your story…">${existing ? escapeHtml(existing.content||"") : ""}</textarea>
    <div class="writer-footbar">
      <span id="writerCount">0 words &middot; 1 min read</span>
      <span>Text-only — no images, video or audio</span>
    </div>
  `;
  $("#side").innerHTML = "";

  $$("#topicRow [data-topic]").forEach(btn => btn.addEventListener("click", () => {
    writerSelectedTopic = btn.dataset.topic;
    $$("#topicRow [data-topic]").forEach(b => b.classList.toggle("is-selected", b === btn));
  }));

  const textarea = $("#writerBody");
  const countEl = $("#writerCount");
  const updateCount = () => {
    const words = textarea.value.trim().split(/\s+/).filter(Boolean).length;
    countEl.textContent = `${words} words · ${readingTime(textarea.value)} min read`;
  };
  textarea.addEventListener("input", updateCount);
  updateCount();

  $$(".editor-toolbar [data-cmd]").forEach(btn => btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    if (cmd === "bold") insertAtCursor(textarea, "**", "**");
    else if (cmd === "italic") insertAtCursor(textarea, "_", "_");
    else if (cmd === "h2") insertAtCursor(textarea, "\n## ", "");
    else if (cmd === "quote") insertAtCursor(textarea, "\n> ", "");
    else if (cmd === "ul") insertAtCursor(textarea, "\n- ", "");
    else if (cmd === "ol") insertAtCursor(textarea, "\n1. ", "");
    else if (cmd === "link") insertAtCursor(textarea, "[", "](https://)");
  }));

  function readForm(){
    return { title: $("#writerTitle").value.trim(), content: textarea.value.trim(), topic: writerSelectedTopic };
  }
  function showError(msg){
    const el = $("#writerError");
    el.textContent = msg; el.classList.remove("hidden");
  }

  $("#previewBtn").addEventListener("click", () => {
    const { title, content: body } = readForm();
    openModal(`
      <button class="iconbtn modal-close" data-close-modal aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <h1 class="reader-title" style="font-size:24px;">${escapeHtml(title||"Untitled")}</h1>
      <div class="reader-body" style="font-size:16px;">${paragraphsToHtml(body)}</div>
    `);
  });

  $("#saveDraftBtn").addEventListener("click", async () => {
    const { title, content: body, topic } = readForm();
    if (!title && !body){ showError("Write something before saving a draft."); return; }
    try{
      if (writerDraftId){
        await updateDoc(doc(db, "posts", writerDraftId), { title, content: body, topic, readingTime: readingTime(body), status: "draft", updatedAt: serverTimestamp() });
      } else {
        const ref = await addDoc(collection(db, "posts"), {
          title, content: body, topic, authorId: me.uid, status: "draft",
          slug: slugify(title||"untitled"), likeCount: 0, commentCount: 0, viewCount: 0,
          readingTime: readingTime(body), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        writerDraftId = ref.id;
      }
      toast("Draft saved");
      location.hash = "#/drafts";
    }catch(err){ console.error(err); showError("Couldn't save draft — try again."); }
  });

  $("#publishBtn").addEventListener("click", async () => {
    const { title, content: body, topic } = readForm();
    if (!title) return showError("Title is required.");
    if (!body) return showError("Content is required.");
    if (!topic) return showError("Please choose a topic.");
    $("#publishBtn").disabled = true;
    try{
      if (writerDraftId){
        await updateDoc(doc(db, "posts", writerDraftId), { title, content: body, topic, readingTime: readingTime(body), status: "published", updatedAt: serverTimestamp() });
      } else {
        const ref = await addDoc(collection(db, "posts"), {
          title, content: body, topic, authorId: me.uid, status: "published",
          slug: slugify(title), likeCount: 0, commentCount: 0, viewCount: 0,
          readingTime: readingTime(body), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        writerDraftId = ref.id;
        await updateDoc(doc(db, "users", me.uid), { postCount: increment(1) }).catch(()=>{});
      }
      await addDoc(collection(db, "notifications"), {
        userId: me.uid, type: "published", read: false, createdAt: serverTimestamp()
      });
      toast("Published!");
      location.hash = "#/my-posts";
    }catch(err){ console.error(err); showError("Couldn't publish — try again."); }
    finally{ $("#publishBtn").disabled = false; }
  });
}

/* ---------- Drafts ---------- */

async function renderDrafts(){
  const content = $("#content");
  content.innerHTML = `<h1 class="page-title">Drafts</h1><div id="draftsList">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  try{
    const drafts = await fetchPostsByAuthor(me.uid, "draft");
    const list = $("#draftsList");
    if (!drafts.length){ list.innerHTML = emptyState("No drafts", "Start writing and save a draft to continue later."); return; }
    list.innerHTML = drafts.map(d => `
      <div class="listcard" data-id="${d.id}">
        <div class="listcard-body">
          <div class="listcard-title">${escapeHtml(d.title||"Untitled")}</div>
          <div class="listcard-meta">${d.topic ? escapeHtml(d.topic)+" &middot; " : ""}Edited ${timeAgo(d.updatedAt)} &middot; <b>${(d.content||"").trim().split(/\s+/).filter(Boolean).length}</b> words</div>
        </div>
        <div class="listcard-actions">
          <button class="btn btn-subtle btn-sm" data-continue="${d.id}">Continue</button>
          <button class="btn btn-danger btn-sm" data-delete="${d.id}">Delete</button>
        </div>
      </div>`).join("");
    $$("[data-continue]", list).forEach(b => b.addEventListener("click", () => location.hash = "#/write/" + b.dataset.continue));
    $$("[data-delete]", list).forEach(b => b.addEventListener("click", () => confirmDialog({
      title: "Delete this draft?", body: "This can't be undone.",
      onConfirm: async () => { await deleteDoc(doc(db, "posts", b.dataset.delete)); toast("Draft deleted"); renderDrafts(); }
    })));
  }catch(err){ console.error(err); $("#draftsList").innerHTML = errorState(); }
}

/* ---------- My Posts ---------- */

async function renderMyPosts(){
  const content = $("#content");
  content.innerHTML = `
    <h1 class="page-title">My Posts</h1>
    <div class="sort-row">
      <select class="sort-select" id="mySortSelect">
        <option value="latest">Latest</option>
        <option value="viewed">Most viewed</option>
        <option value="liked">Most liked</option>
      </select>
    </div>
    <div id="myPostsList">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  let posts = [];
  try{ posts = await fetchPostsByAuthor(me.uid, "published"); }
  catch(err){ console.error(err); $("#myPostsList").innerHTML = errorState(); return; }
  paintMyPosts(posts);
  $("#mySortSelect").addEventListener("change", e => {
    const v = e.target.value;
    const sorted = [...posts].sort((a,b) => v==="viewed" ? (b.viewCount||0)-(a.viewCount||0) : v==="liked" ? (b.likeCount||0)-(a.likeCount||0) : (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    paintMyPosts(sorted);
  });
}
function paintMyPosts(posts){
  const list = $("#myPostsList");
  if (!posts.length){ list.innerHTML = emptyState("No posts yet", "Publish your first post to see it here."); return; }
  list.innerHTML = posts.map(p => `
    <div class="listcard" data-id="${p.id}">
      <div class="listcard-body">
        <div class="listcard-title"><a href="#/post/${encodeURIComponent(p.slug||p.id)}">${escapeHtml(p.title||"Untitled")}</a></div>
        <div class="listcard-meta"><b>${p.viewCount||0}</b> views &middot; <b>${p.likeCount||0}</b> likes &middot; <b>${p.commentCount||0}</b> comments &middot; ${timeAgo(p.createdAt)}</div>
      </div>
      <div class="listcard-actions">
        <button class="btn btn-subtle btn-sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-del="${p.id}">Delete</button>
      </div>
    </div>`).join("");
  $$("[data-edit]", list).forEach(b => b.addEventListener("click", () => location.hash = "#/write/" + b.dataset.edit));
  $$("[data-del]", list).forEach(b => b.addEventListener("click", () => confirmDialog({
    title: "Delete this post?", body: "This can't be undone. It will be removed for everyone.",
    onConfirm: async () => { await deleteDoc(doc(db, "posts", b.dataset.del)); await updateDoc(doc(db,"users",me.uid),{postCount:increment(-1)}).catch(()=>{}); toast("Post deleted"); renderMyPosts(); }
  })));
}

/* ---------- Bookmarks / Likes ---------- */

async function renderBookmarks(){
  const content = $("#content");
  content.innerHTML = `<h1 class="page-title">Bookmarks</h1><div id="bmList">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  try{
    const ids = [...myBookmarks];
    if (!ids.length){ $("#bmList").innerHTML = emptyState("No bookmarks yet", "Save posts to read later — tap the bookmark icon on any post."); return; }
    const posts = (await Promise.all(ids.map(id => getDoc(doc(db,"posts",id))))).filter(s=>s.exists()).map(s=>({id:s.id,...s.data()}));
    const authors = await fetchAuthorsFor(posts);
    $("#bmList").innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No bookmarks yet", "Save posts to read later.");
    wirePostCardEvents($("#bmList"));
  }catch(err){ console.error(err); $("#bmList").innerHTML = errorState(); }
}

async function renderLikes(){
  const content = $("#content");
  content.innerHTML = `<h1 class="page-title">Liked Posts</h1><div id="likesList">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  try{
    const ids = [...myLikes];
    if (!ids.length){ $("#likesList").innerHTML = emptyState("No liked posts yet", "Posts you like will show up here."); return; }
    const posts = (await Promise.all(ids.map(id => getDoc(doc(db,"posts",id))))).filter(s=>s.exists()).map(s=>({id:s.id,...s.data()}));
    const authors = await fetchAuthorsFor(posts);
    $("#likesList").innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No liked posts yet", "Posts you like will show up here.");
    wirePostCardEvents($("#likesList"));
  }catch(err){ console.error(err); $("#likesList").innerHTML = errorState(); }
}

/* ---------- Notifications page ---------- */

async function renderNotifications(){
  const content = $("#content");
  content.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h1 class="page-title" style="margin-bottom:0;">Notifications</h1>
      <button class="btn btn-subtle btn-sm" id="markAllReadBtn">Mark all as read</button>
    </div>
    <div id="notifList">${skeletonRows(4)}</div>`;
  $("#side").innerHTML = "";
  let items = [];
  try{ items = await fetchMyNotifications(50); }
  catch(err){ console.error(err); $("#notifList").innerHTML = errorState(); return; }
  updateNotifBadge(items);
  const list = $("#notifList");
  list.innerHTML = items.length ? items.map(n => `
    <div class="notif-item ${n.read?"":"is-unread"}" data-notif="${n.id}" data-post="${n.postId||""}">
      <span class="notif-icon">${notifIcon(n.type)}</span>
      <div><div class="notif-text">${notifText(n)}</div><div class="notif-time">${timeAgo(n.createdAt)}</div></div>
    </div>`).join("") : emptyState("No notifications", "Activity on your posts and profile will appear here.");
  $$("[data-notif]", list).forEach(el => el.addEventListener("click", async () => {
    await updateDoc(doc(db, "notifications", el.dataset.notif), { read: true }).catch(()=>{});
    el.classList.remove("is-unread");
    if (el.dataset.post) location.hash = "#/post/" + el.dataset.post;
  }));
  $("#markAllReadBtn").addEventListener("click", async () => {
    const batch = writeBatch(db);
    items.filter(n => !n.read).forEach(n => batch.update(doc(db,"notifications",n.id), { read: true }));
    await batch.commit().catch(()=>{});
    $$(".notif-item", list).forEach(el => el.classList.remove("is-unread"));
    toast("All caught up");
    $("#notifBadge").classList.add("hidden");
  });
}

/* ---------- Post reader (with working actions) ---------- */

async function renderReader(slug){
  const content = $("#content");
  content.innerHTML = skeletonCards(1);
  $("#side").innerHTML = "";
  const post = await fetchPostBySlug(decodeURIComponent(slug)).catch(() => null);
  if (!post){ content.innerHTML = emptyState("Post not found", "It may have been removed, or the link is incorrect."); return; }

  updateDoc(doc(db, "posts", post.id), { viewCount: increment(1) }).catch(()=>{});

  const authorSnap = post.authorId ? await getDoc(doc(db, "users", post.authorId)) : null;
  const author = authorSnap && authorSnap.exists() ? { id: authorSnap.id, ...authorSnap.data() } : {};
  const mins = post.readingTime || readingTime(post.content||"");
  const liked = myLikes.has(post.id), saved = myBookmarks.has(post.id);
  const isOwner = post.authorId === me.uid;
  const isFollowing = myFollowing.has(post.authorId);

  content.innerHTML = `
    <div class="reader-meta">${post.topic ? `<span class="topic-chip">${escapeHtml(post.topic)}</span>` : ""}</div>
    <h1 class="reader-title">${escapeHtml(post.title||"Untitled")}</h1>
    <div class="reader-byline">
      ${avatarHtml(author)}
      <div class="reader-byline-info">
        <div class="byline-name"><a href="#/@${escapeHtml(author.username||"")}">${escapeHtml(author.name||"Unknown")}</a></div>
        <div class="byline-meta">${timeAgo(post.createdAt)} &middot; ${mins} min read</div>
      </div>
      ${!isOwner ? `<button class="btn btn-primary btn-sm follow-btn ${isFollowing?"is-following":""}" data-follow="${post.authorId}">${isFollowing?"Following":"Follow"}</button>` : `<button class="btn btn-subtle btn-sm" data-edit="${post.id}">Edit</button>`}
    </div>
    <div class="reader-body">${paragraphsToHtml(post.content||"")}</div>
    <div class="reader-actions">
      <button class="postcard-stat ${liked?"is-liked":""}" data-like="${post.id}" data-author="${post.authorId||""}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20s-7.5-4.6-9.8-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.8 5c-2.3 4.4-9.8 9-9.8 9Z"/></svg>
        <span class="count">${post.likeCount||0}</span> Like
      </button>
      <button class="postcard-stat ${saved?"is-saved":""}" data-bookmark="${post.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg> Save
      </button>
      <button class="postcard-stat" data-share="${escapeHtml(post.slug||post.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7 15.9 6.3M8.1 13.3l7.8 4.4"/></svg> Share
      </button>
      ${!isOwner ? `<button class="postcard-stat" id="reportPostBtn" style="margin-left:auto;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M5 3v18M5 4h11l-2 4 2 4H5"/></svg> Report</button>` : ""}
    </div>

    <div class="author-box">
      ${avatarHtml(author, "lg")}
      <div class="author-box-body">
        <div class="author-box-name">${escapeHtml(author.name||"Unknown")}</div>
        <p class="author-box-bio">${escapeHtml(author.bio||"No bio yet.")}</p>
        <div class="author-box-stats"><b>${author.followerCount||0}</b> followers &middot; <b>${author.followingCount||0}</b> following</div>
        ${!isOwner ? `<button class="btn btn-primary btn-sm follow-btn ${isFollowing?"is-following":""}" data-follow="${post.authorId}">${isFollowing?"Following":"Follow"}</button>` : ""}
      </div>
    </div>

    <h2 class="comments-head">Comments</h2>
    <div class="field" style="display:flex;gap:10px;align-items:flex-start;">
      ${avatarHtml(meDoc)}
      <div style="flex:1;">
        <textarea id="newComment" rows="2" placeholder="Add a comment…" style="width:100%;border:1px solid var(--line-strong);border-radius:var(--radius-m);padding:10px 12px;font-size:14.5px;"></textarea>
        <button class="btn btn-primary btn-sm" id="postCommentBtn" style="margin-top:8px;">Comment</button>
      </div>
    </div>
    <div id="commentsList" style="margin-top:14px;">${skeletonRows(2)}</div>
  `;
  wirePostCardEvents(content);
  $$("[data-follow]", content).forEach(b => b.addEventListener("click", () => toggleFollow(b.dataset.follow, b)));
  const editBtn = $("[data-edit]", content);
  if (editBtn) editBtn.addEventListener("click", () => location.hash = "#/write/" + post.id);
  const reportBtn = $("#reportPostBtn");
  if (reportBtn) reportBtn.addEventListener("click", () => reportDialog("post", post.id));

  $("#postCommentBtn").addEventListener("click", () => submitComment(post, null));

  await paintComments(post);
}

async function paintComments(post){
  try{
    const q = query(collection(db, "comments"), where("postId", "==", post.id), orderBy("createdAt", "asc"), limit(200));
    const snap = await getDocs(q);
    const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const top = comments.filter(c => !c.parentId);
    const wrap = $("#commentsList");
    wrap.innerHTML = top.length ? top.map(c => commentHtml(c, comments)).join("") : emptyState("No comments yet", "Be the first to share your thoughts.");
    wireCommentEvents(wrap, post);
  }catch(err){ console.error(err); $("#commentsList").innerHTML = errorState(); }
}

function commentHtml(c, all){
  const replies = all.filter(r => r.parentId === c.id);
  const mine = c.authorId === me.uid;
  return `
  <div class="comment" data-comment-id="${c.id}">
    ${avatarHtml({ name: c.authorName, avatarBase64: c.authorAvatar })}
    <div class="comment-body">
      <div class="comment-bubble">
        <div class="comment-author">${escapeHtml(c.authorName||"Someone")}</div>
        <div class="comment-text">${escapeHtml(c.text||"")}</div>
      </div>
      <div class="comment-actions">
        <button class="comment-action" data-like-comment="${c.id}">Like ${c.likeCount?`(${c.likeCount})`:""}</button>
        <button class="comment-action" data-reply="${c.id}">Reply</button>
        ${mine ? `<button class="comment-action" data-delete-comment="${c.id}">Delete</button>` : `<button class="comment-action" data-report-comment="${c.id}">Report</button>`}
        <span class="comment-action">${timeAgo(c.createdAt)}</span>
      </div>
      <div class="reply-box hidden" id="replyBox-${c.id}" style="margin-top:8px;display:flex;gap:8px;">
        <input type="text" placeholder="Write a reply…" style="flex:1;height:36px;padding:0 10px;border:1px solid var(--line-strong);border-radius:var(--radius-m);font-size:13.5px;">
        <button class="btn btn-primary btn-sm" data-send-reply="${c.id}">Send</button>
      </div>
      ${replies.length ? `<div class="comment-replies">${replies.map(r => commentHtml(r, all)).join("")}</div>` : ""}
    </div>
  </div>`;
}

function wireCommentEvents(root, post){
  $$("[data-like-comment]", root).forEach(btn => btn.addEventListener("click", () => toggleCommentLike(btn.dataset.likeComment, btn)));
  $$("[data-reply]", root).forEach(btn => btn.addEventListener("click", () => {
    const box = $("#replyBox-" + btn.dataset.reply);
    box.classList.toggle("hidden");
    if (!box.classList.contains("hidden")) box.querySelector("input").focus();
  }));
  $$("[data-send-reply]", root).forEach(btn => btn.addEventListener("click", () => {
    const box = $("#replyBox-" + btn.dataset.sendReply);
    const input = box.querySelector("input");
    if (!input.value.trim()) return;
    submitComment(post, btn.dataset.sendReply, input.value.trim());
  }));
  $$("[data-delete-comment]", root).forEach(btn => btn.addEventListener("click", () => confirmDialog({
    title: "Delete this comment?", body: "This can't be undone.",
    onConfirm: async () => {
      await deleteDoc(doc(db, "comments", btn.dataset.deleteComment));
      await updateDoc(doc(db, "posts", post.id), { commentCount: increment(-1) }).catch(()=>{});
      toast("Comment deleted");
      paintComments(post);
    }
  })));
  $$("[data-report-comment]", root).forEach(btn => btn.addEventListener("click", () => reportDialog("comment", btn.dataset.reportComment)));
}

async function toggleCommentLike(commentId, btn){
  const ref = doc(db, "commentLikes", `${commentId}_${me.uid}`);
  const already = btn.classList.contains("is-liked-comment");
  btn.classList.toggle("is-liked-comment");
  try{
    if (!already){
      await setDoc(ref, { commentId, userId: me.uid, createdAt: serverTimestamp() });
      await updateDoc(doc(db, "comments", commentId), { likeCount: increment(1) });
    } else {
      await deleteDoc(ref);
      await updateDoc(doc(db, "comments", commentId), { likeCount: increment(-1) });
    }
  }catch(err){ console.error(err); }
}

async function submitComment(post, parentId, replyText){
  const input = parentId ? null : $("#newComment");
  const text = parentId ? replyText : input.value.trim();
  if (!text) return;
  try{
    await addDoc(collection(db, "comments"), {
      postId: post.id, authorId: me.uid, authorName: meDoc.name, authorAvatar: meDoc.avatarBase64||"",
      text, parentId: parentId || null, likeCount: 0, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "posts", post.id), { commentCount: increment(1) });
    if (post.authorId && post.authorId !== me.uid){
      await addDoc(collection(db, "notifications"), {
        userId: post.authorId, type: parentId ? "reply" : "comment",
        fromUserId: me.uid, fromUserName: meDoc.name, postId: post.id, read: false, createdAt: serverTimestamp()
      });
    }
    if (input) input.value = "";
    toast(parentId ? "Reply posted" : "Comment posted");
    await paintComments(post);
  }catch(err){ console.error(err); toast("Couldn't post — try again"); }
}

/* ---------- Profile ---------- */

function resizeImageToBase64(file, maxSize = 200){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > height){ if (width > maxSize){ height *= maxSize/width; width = maxSize; } }
        else { if (height > maxSize){ width *= maxSize/height; height = maxSize; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function renderProfile(username){
  const isSelf = !username;
  const content = $("#content");
  content.innerHTML = skeletonRows(1) + skeletonCards(2);
  $("#side").innerHTML = "";

  const user = isSelf ? { id: me.uid, ...meDoc } : await fetchUserByUsername(decodeURIComponent(username)).catch(() => null);
  if (!user){ content.innerHTML = emptyState("Profile not found", "This user doesn't exist."); return; }
  const following = myFollowing.has(user.id);

  content.innerHTML = `
    <div class="profile-head">
      <div style="position:relative;">
        ${avatarHtml(user, "xl")}
        ${isSelf ? `<input type="file" id="avatarInput" accept="image/*" class="hidden">
        <button class="iconbtn" id="avatarEditBtn" style="position:absolute;bottom:-4px;right:-4px;background:var(--surface);border:1px solid var(--line);" aria-label="Change photo">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/></svg>
        </button>` : ""}
      </div>
      <div>
        <div class="profile-name">${escapeHtml(user.name||"")}</div>
        <div class="profile-handle">@${escapeHtml(user.username||"")}</div>
        <p class="profile-bio">${escapeHtml(user.bio||"No bio yet.")}</p>
        <div class="profile-stats"><span><b>${user.postCount||0}</b> Posts</span><span><b>${user.followerCount||0}</b> Followers</span><span><b>${user.followingCount||0}</b> Following</span></div>
      </div>
    </div>
    ${isSelf ? `<button class="btn btn-subtle" id="editProfileBtn" style="margin-bottom:22px;">Edit profile</button>`
      : `<button class="btn btn-primary follow-btn ${following?"is-following":""}" data-follow="${user.id}" style="margin-bottom:22px;">${following?"Following":"Follow"}</button>`}
    <div class="tabs">
      <button class="tab is-active" data-ptab="posts">Posts</button>
      ${isSelf ? `<button class="tab" data-ptab="bookmarks">Bookmarks</button><button class="tab" data-ptab="liked">Liked</button>` : ""}
    </div>
    <div id="profileTabContent">${skeletonCards(2)}</div>
  `;
  $$("[data-follow]", content).forEach(b => b.addEventListener("click", () => toggleFollow(b.dataset.follow, b)));

  if (isSelf){
    $("#editProfileBtn").addEventListener("click", () => openEditProfile(user));
    $("#avatarEditBtn").addEventListener("click", () => $("#avatarInput").click());
    $("#avatarInput").addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) return;
      const b64 = await resizeImageToBase64(file);
      await updateDoc(doc(db, "users", me.uid), { avatarBase64: b64 });
      meDoc.avatarBase64 = b64;
      paintHeaderIdentity();
      renderProfile();
      toast("Profile photo updated");
    });
  }

  async function paintTab(tab){
    const wrap = $("#profileTabContent");
    wrap.innerHTML = skeletonCards(2);
    try{
      if (tab === "bookmarks"){
        const ids = [...myBookmarks];
        const posts = (await Promise.all(ids.map(id => getDoc(doc(db,"posts",id))))).filter(s=>s.exists()).map(s=>({id:s.id,...s.data()}));
        const authors = await fetchAuthorsFor(posts);
        wrap.innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No bookmarks yet", "Save posts to read later.");
      } else if (tab === "liked"){
        const ids = [...myLikes];
        const posts = (await Promise.all(ids.map(id => getDoc(doc(db,"posts",id))))).filter(s=>s.exists()).map(s=>({id:s.id,...s.data()}));
        const authors = await fetchAuthorsFor(posts);
        wrap.innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No liked posts yet", "Posts you like show up here.");
      } else {
        const posts = await fetchPostsByAuthor(user.id, "published");
        wrap.innerHTML = posts.length ? posts.map(p => postCardHtml(p, user, { ownerMenu: isSelf })).join("") : emptyState("No posts yet", isSelf ? "Publish your first post." : `@${user.username} hasn't published anything yet.`);
      }
      wirePostCardEvents(wrap);
    }catch(err){ console.error(err); wrap.innerHTML = errorState(); }
  }
  $$(".tabs [data-ptab]", content).forEach(tab => tab.addEventListener("click", () => {
    $$(".tabs [data-ptab]", content).forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    paintTab(tab.dataset.ptab);
  }));
  paintTab("posts");
}

function openEditProfile(user){
  openModal(`
    <button class="iconbtn modal-close" data-close-modal aria-label="Close"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    <h2 class="modal-title">Edit profile</h2>
    <form id="editProfileForm">
      <div class="field"><label>Name</label><input id="editName" type="text" value="${escapeHtml(user.name||"")}" required></div>
      <div class="field"><label>Username</label><input id="editUsername" type="text" value="${escapeHtml(user.username||"")}" required></div>
      <div class="field"><label>Bio</label><textarea id="editBio" rows="3">${escapeHtml(user.bio||"")}</textarea></div>
      <p class="field-error hidden" id="editProfileError"></p>
      <button class="btn btn-primary btn-block" type="submit">Save changes</button>
    </form>
  `);
  $("#editProfileForm").addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("#editName").value.trim();
    const username = $("#editUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    const bio = $("#editBio").value.trim();
    const err = $("#editProfileError");
    if (!name || !username){ err.textContent = "Name and username are required."; err.classList.remove("hidden"); return; }
    try{
      await updateDoc(doc(db, "users", me.uid), { name, username, bio });
      meDoc.name = name; meDoc.username = username; meDoc.bio = bio;
      paintHeaderIdentity();
      closeModal();
      toast("Profile updated");
      renderProfile();
    }catch(e2){ err.textContent = "Couldn't save — try again."; err.classList.remove("hidden"); }
  });
}

/* ---------- Analytics ---------- */

async function renderAnalytics(){
  const content = $("#content");
  content.innerHTML = `<h1 class="page-title">Analytics</h1><div id="analyticsBody">${skeletonCards(2)}</div>`;
  $("#side").innerHTML = "";
  try{
    const posts = await fetchPostsByAuthor(me.uid, "published", 100);
    const totalViews = posts.reduce((s,p)=>s+(p.viewCount||0),0);
    const totalLikes = posts.reduce((s,p)=>s+(p.likeCount||0),0);
    const totalComments = posts.reduce((s,p)=>s+(p.commentCount||0),0);
    const top = [...posts].sort((a,b)=>(b.viewCount||0)-(a.viewCount||0)).slice(0,5);
    const maxViews = Math.max(1, ...posts.map(p=>p.viewCount||0));

    $("#analyticsBody").innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-card-label">Total posts</div><div class="stat-card-value">${posts.length}</div></div>
        <div class="stat-card"><div class="stat-card-label">Total views</div><div class="stat-card-value">${totalViews}</div></div>
        <div class="stat-card"><div class="stat-card-label">Total likes</div><div class="stat-card-value">${totalLikes}</div></div>
        <div class="stat-card"><div class="stat-card-label">Total comments</div><div class="stat-card-value">${totalComments}</div></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Views by post</div>
        <div class="bars">${posts.slice(0,14).map(p => `<div class="bar" style="height:${Math.max(4,(p.viewCount||0)/maxViews*140)}px" title="${escapeHtml(p.title||"")}: ${p.viewCount||0} views"></div>`).join("") || `<p class="widget-row-meta">No data yet.</p>`}</div>
      </div>
      <div class="chart-card">
        <div class="chart-card-title">Top posts</div>
        ${top.length ? top.map((p,i) => `
          <div class="top-post-row">
            <span class="top-post-rank">${i+1}</span>
            <span class="top-post-title">${escapeHtml(p.title||"Untitled")}</span>
            <span class="top-post-stat">${p.viewCount||0} views &middot; ${p.likeCount||0} likes</span>
          </div>`).join("") : `<p class="widget-row-meta">Publish posts to see your top performers.</p>`}
      </div>
    `;
  }catch(err){ console.error(err); $("#analyticsBody").innerHTML = errorState(); }
}

/* ---------- Settings ---------- */

async function renderSettings(){
  const content = $("#content");
  content.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="settings-section">
      <div class="settings-section-title">Account</div>
      <div class="settings-row"><div><div class="settings-row-label">Email</div><div class="settings-row-hint">${escapeHtml(me.email||"")}</div></div></div>
      <div class="settings-row"><div><div class="settings-row-label">Profile details</div><div class="settings-row-hint">Name, username, bio and photo</div></div><button class="btn btn-subtle btn-sm" id="goEditProfile">Edit</button></div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Notifications</div>
      <div class="settings-row"><div><div class="settings-row-label">Likes &amp; comments</div><div class="settings-row-hint">Get notified on your posts</div></div><div class="toggle is-on" data-toggle><span class="toggle-knob"></span></div></div>
      <div class="settings-row"><div><div class="settings-row-label">New followers</div><div class="settings-row-hint">Get notified when someone follows you</div></div><div class="toggle is-on" data-toggle><span class="toggle-knob"></span></div></div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Session</div>
      <button class="btn btn-danger" id="settingsLogout">Log out</button>
    </div>
  `;
  $("#side").innerHTML = "";
  $("#goEditProfile").addEventListener("click", () => openEditProfile({ id: me.uid, ...meDoc }));
  $$("[data-toggle]", content).forEach(t => t.addEventListener("click", () => t.classList.toggle("is-on")));
  $("#settingsLogout").addEventListener("click", () => confirmDialog({
    title: "Log out of Knowbit?", body: "You can log back in anytime.", confirmLabel: "Log out", danger: false,
    onConfirm: async () => { await signOut(auth); window.location.href = "index.html"; }
  }));
}

/* ---------- Search ---------- */

async function renderSearchResults(term){
  const content = $("#content");
  const t = decodeURIComponent(term);
  content.innerHTML = `<h1 class="page-title">Results for "${escapeHtml(t)}"</h1><div id="searchResults">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  try{
    const posts = await fetchPublishedPosts("createdAt", 60);
    const low = t.toLowerCase();
    const matches = posts.filter(p => (p.title||"").toLowerCase().includes(low) || (p.topic||"").toLowerCase().includes(low));
    const authors = await fetchAuthorsFor(matches);
    $("#searchResults").innerHTML = matches.length ? matches.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No results", "Try a different search term.");
    wirePostCardEvents($("#searchResults"));
  }catch(err){ console.error(err); $("#searchResults").innerHTML = errorState(); }
}

/* ============================== router ============================== */

function renderRailTopics(){
  $("#railTopics").innerHTML = TOPICS.slice(0,6).map(t => `<a href="#/" class="rail-topic"><span>${t}</span></a>`).join("");
}

const routes = [
  { test: h => h === "" || h === "#/" || h === "#/home", run: renderHome, name: "home" },
  { test: h => h === "#/explore", run: renderExplore, name: "explore" },
  { test: h => h === "#/write", run: () => renderWriter(null) },
  { test: h => h.startsWith("#/write/"), run: h => renderWriter(h.split("#/write/")[1]) },
  { test: h => h === "#/drafts", run: renderDrafts, name: "drafts" },
  { test: h => h === "#/my-posts", run: renderMyPosts, name: "my-posts" },
  { test: h => h === "#/bookmarks", run: renderBookmarks, name: "bookmarks" },
  { test: h => h === "#/likes", run: renderLikes, name: "likes" },
  { test: h => h === "#/notifications", run: renderNotifications, name: "notifications" },
  { test: h => h === "#/analytics", run: renderAnalytics, name: "analytics" },
  { test: h => h === "#/settings", run: renderSettings, name: "settings" },
  { test: h => h === "#/profile", run: () => renderProfile(null), name: "profile" },
  { test: h => h.startsWith("#/post/"), run: h => renderReader(h.split("#/post/")[1]) },
  { test: h => h.startsWith("#/@"), run: h => renderProfile(h.split("#/@")[1]) },
  { test: h => h.startsWith("#/search/"), run: h => renderSearchResults(h.split("#/search/")[1]) },
];

function updateNavActive(){
  const hash = location.hash;
  let name = "home";
  if (hash === "#/explore") name = "explore";
  else if (hash === "#/bookmarks") name = "bookmarks";
  else if (hash === "#/likes") name = "likes";
  else if (hash === "#/notifications") name = "notifications";
  else if (hash === "#/my-posts") name = "my-posts";
  else if (hash === "#/drafts") name = "drafts";
  else if (hash === "#/analytics") name = "analytics";
  else if (hash === "#/settings") name = "settings";
  else if (hash === "#/profile") name = "profile";
  $$("[data-route]").forEach(el => el.classList.toggle("is-active", el.dataset.route === name));
}

function router(){
  if (!me) return; // wait for auth
  const hash = location.hash;
  const match = routes.find(r => r.test(hash)) || routes[0];
  window.scrollTo(0, 0);
  match.run(hash);
  updateNavActive();
}
window.addEventListener("hashchange", router);
