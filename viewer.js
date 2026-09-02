// viewer.js — Knowbit guest experience.
// Reads live data from Firestore. Guests can read, search and explore.
// Any write-ish action (like, comment, follow, bookmark, write) opens
// the signup prompt instead of performing the action.

import {
  auth, db, googleProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithRedirect, getRedirectResult,
  sendPasswordResetEmail, onAuthStateChanged, updateProfile,
  doc, getDoc, setDoc, collection, query, where, orderBy, limit, getDocs
} from "./firebase-config.js";

/* ============================== helpers ============================== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str = ""){
  return str.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function initials(name = "?"){
  return name.trim().split(/\s+/).slice(0,2).map(w => w[0]?.toUpperCase() || "").join("") || "?";
}

function avatarHtml(user = {}, size = ""){
  const cls = "avatar" + (size ? ` avatar-${size}` : "");
  if (user.avatarBase64) return `<div class="${cls}"><img src="${user.avatarBase64}" alt=""></div>`;
  return `<div class="${cls}">${initials(user.name || user.username)}</div>`;
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

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("is-shown");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-shown"), 2200);
}

function paragraphsToHtml(text = ""){
  return text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

const TOPICS = ["Technology","Education","Science","Business","Programming","Productivity","History","Career","Finance"];

/* ============================== modal ============================== */

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

function guestGate(actionLabel = "do that"){
  openAuthModal("signup", `Join Knowbit to ${actionLabel}.`);
}

function openAuthModal(mode = "login", reason = ""){
  const isLogin = mode === "login";
  openModal(`
    <button class="iconbtn modal-close" data-close-modal aria-label="Close">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <h2 class="modal-title">${isLogin ? "Log in to Knowbit" : "Create your account"}</h2>
    <p class="modal-sub">${reason || (isLogin ? "Welcome back — pick up where you left off." : "Read, write and follow ideas that matter to you.")}</p>

    <button class="oauth-btn" id="googleAuthBtn" type="button">
      <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.6 9.2c0-.6-.05-1.2-.15-1.75H9v3.32h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.66-3.87 2.66-6.55Z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.55-1.85.87-3.06.87-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.95 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.95a9 9 0 0 0 0 8.08l3-2.33Z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .95 4.96l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/></svg>
      Continue with Google
    </button>

    <div class="divider-word">or</div>

    <form id="authForm" novalidate>
      ${isLogin ? "" : `
      <div class="field">
        <label for="authName">Full name</label>
        <input id="authName" type="text" autocomplete="name" required>
      </div>`}
      <div class="field">
        <label for="authEmail">Email</label>
        <input id="authEmail" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label for="authPassword">Password</label>
        <input id="authPassword" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" minlength="6" required>
      </div>
      <p class="field-error hidden" id="authError"></p>
      ${isLogin ? `<p class="field-hint"><a href="#" id="forgotPasswordLink">Forgot password?</a></p>` : ""}
      <button class="btn btn-primary btn-block" type="submit" style="margin-top:6px;">${isLogin ? "Log in" : "Create account"}</button>
    </form>

    <p class="modal-switch">
      ${isLogin ? "New to Knowbit?" : "Already have an account?"}
      <button type="button" id="authSwitch">${isLogin ? "Sign up" : "Log in"}</button>
    </p>
  `);

  $("#authSwitch").addEventListener("click", () => openAuthModal(isLogin ? "signup" : "login"));
  $("#googleAuthBtn").addEventListener("click", handleGoogleAuth);
  $("#authForm").addEventListener("submit", e => handleEmailAuth(e, isLogin));
  const forgot = $("#forgotPasswordLink");
  if (forgot) forgot.addEventListener("click", e => { e.preventDefault(); openForgotPassword(); });
}

function openForgotPassword(){
  openModal(`
    <button class="iconbtn modal-close" data-close-modal aria-label="Close">
      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
    <h2 class="modal-title">Reset your password</h2>
    <p class="modal-sub">We'll email you a link to set a new password.</p>
    <form id="resetForm" novalidate>
      <div class="field">
        <label for="resetEmail">Email</label>
        <input id="resetEmail" type="email" autocomplete="email" required>
      </div>
      <p class="field-error hidden" id="resetError"></p>
      <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
    </form>
    <p class="modal-switch"><button type="button" id="backToLogin">Back to log in</button></p>
  `);
  $("#backToLogin").addEventListener("click", () => openAuthModal("login"));
  $("#resetForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("#resetEmail").value.trim();
    const errEl = $("#resetError");
    errEl.classList.add("hidden");
    try{
      await sendPasswordResetEmail(auth, email);
      toast("Reset link sent — check your inbox");
      closeModal();
    }catch(err){
      errEl.textContent = friendlyAuthError(err);
      errEl.classList.remove("hidden");
    }
  });
}

function friendlyAuthError(err){
  const code = err.code || "";
  if (code.includes("email-already-in-use")) return "That email already has an account — try logging in.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Email or password is incorrect.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "That email doesn't look right.";
  if (code.includes("popup-closed-by-user")) return "Google sign-in was closed before finishing.";
  return "Something went wrong. Please try again.";
}

async function ensureUserDoc(fbUser, fallbackName){
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()){
    const base = (fbUser.email || "user").split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase();
    await setDoc(ref, {
      name: fallbackName || fbUser.displayName || "New writer",
      username: base + Math.floor(Math.random()*900 + 100),
      email: fbUser.email || "",
      bio: "",
      avatarBase64: "",
      role: "user",
      followerCount: 0,
      followingCount: 0,
      postCount: 0,
      createdAt: new Date()
    });
  }
}

async function handleEmailAuth(e, isLogin){
  e.preventDefault();
  const errEl = $("#authError");
  errEl.classList.add("hidden");
  const email = $("#authEmail").value.trim();
  const password = $("#authPassword").value;
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try{
    if (isLogin){
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      const name = $("#authName").value.trim();
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await ensureUserDoc(cred.user, name);
    }
    closeModal();
    toast(isLogin ? "Welcome back!" : "Account created");
    setTimeout(() => { window.location.href = "user.html"; }, 500);
  }catch(err){
    errEl.textContent = friendlyAuthError(err);
    errEl.classList.remove("hidden");
  }finally{
    submitBtn.disabled = false;
  }
}

async function handleGoogleAuth(){
  await signInWithRedirect(auth, googleProvider);
}

$("#loginBtn").addEventListener("click", () => openAuthModal("login"));
$("#signupBtn").addEventListener("click", () => openAuthModal("signup"));
$("#railSignup").addEventListener("click", () => openAuthModal("signup"));
$("#bottomSignup").addEventListener("click", () => openAuthModal("signup"));

// If already signed in, sailing to index.html doesn't make sense — bounce to app.
onAuthStateChanged(auth, user => { if (user) { /* stay silent: user may have just logged out mid-browse */ } });
getRedirectResult(auth).then(async cred => {
  if (!cred) return;
  await ensureUserDoc(cred.user);
  toast("Welcome to Knowbit!");
  setTimeout(() => { window.location.href = "user.html"; }, 500);
}).catch(err => toast(friendlyAuthError(err)));
/* ============================== data layer ============================== */

async function fetchPublishedPosts(sortField = "createdAt", max = 20){
  const q = query(
    collection(db, "posts"),
    where("status", "==", "published"),
    orderBy(sortField, "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchAuthorsFor(posts){
  const ids = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
  const authors = {};
  await Promise.all(ids.map(async uid => {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) authors[uid] = { id: uid, ...snap.data() };
  }));
  return authors;
}

async function fetchPostBySlug(slug){
  const q = query(collection(db, "posts"), where("slug", "==", slug), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function fetchUserByUsername(username){
  const q = query(collection(db, "users"), where("username", "==", username), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

async function fetchCommentsForPost(postId){
  const q = query(collection(db, "comments"), where("postId", "==", postId), orderBy("createdAt", "asc"), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchPostsByAuthor(authorId, max = 20){
  const q = query(
    collection(db, "posts"),
    where("authorId", "==", authorId),
    where("status", "==", "published"),
    orderBy("createdAt", "desc"),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fetchTopWriters(max = 4){
  const q = query(collection(db, "users"), orderBy("followerCount", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ============================== rendering: post card ============================== */

function postCardHtml(post, author = {}){
  const title = escapeHtml(post.title || "Untitled");
  const excerpt = escapeHtml((post.content || "").replace(/\n+/g, " ")).slice(0, 180);
  const mins = post.readingTime || readingTime(post.content || "");
  return `
  <article class="postcard">
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
    <h3 class="postcard-title"><a href="#/post/${encodeURIComponent(post.slug || post.id)}">${title}</a></h3>
    <p class="postcard-excerpt">${excerpt}${excerpt.length >= 180 ? "…" : ""}</p>
    <div class="postcard-foot">
      <button class="postcard-stat" data-guard="like this post">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20s-7.5-4.6-9.8-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.8 5c-2.3 4.4-9.8 9-9.8 9Z"/></svg>
        ${post.likeCount || 0}
      </button>
      <button class="postcard-stat" data-guard="comment on this post">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 5h16v11H8l-4 4V5Z"/></svg>
        ${post.commentCount || 0}
      </button>
      <button class="postcard-stat" data-guard="bookmark this post">
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
  $$("[data-guard]", root).forEach(btn => btn.addEventListener("click", () => guestGate(btn.dataset.guard)));
  $$("[data-share]", root).forEach(btn => btn.addEventListener("click", () => {
    const url = `${location.origin}${location.pathname}#/post/${btn.dataset.share}`;
    navigator.clipboard?.writeText(url).then(() => toast("Link copied")).catch(() => toast(url));
  }));
}

/* ============================== pages ============================== */

let cachedPosts = [];
let cachedAuthors = {};

async function renderHome(){
  const content = $("#content");
  content.innerHTML = `
    <div class="tabs" role="tablist">
      <button class="tab is-active" data-tab="foryou">For You</button>
      <button class="tab" data-tab="latest">Latest</button>
    </div>
    <div id="feedList">${skeletonCards(4)}</div>
  `;

  try{
    cachedPosts = await fetchPublishedPosts("createdAt", 20);
    cachedAuthors = await fetchAuthorsFor(cachedPosts);
  }catch(err){
    console.error(err);
    $("#feedList").innerHTML = errorState();
    return;
  }

  paintFeed(cachedPosts);

  $$(".tab", content).forEach(tab => tab.addEventListener("click", () => {
    $$(".tab", content).forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const list = tab.dataset.tab === "latest"
      ? [...cachedPosts].sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
      : [...cachedPosts].sort((a,b) => (b.likeCount||0) - (a.likeCount||0));
    paintFeed(list);
  }));

  renderSidebar();
}

function paintFeed(posts){
  const list = $("#feedList");
  if (!posts.length){
    list.innerHTML = emptyState("No posts yet", "When writers publish, their posts will show up here.");
    return;
  }
  list.innerHTML = posts.map(p => postCardHtml(p, cachedAuthors[p.authorId] || {})).join("");
  wirePostCardEvents(list);
}

function skeletonCards(n){
  return Array.from({length:n}).map(() => `
    <div class="postcard">
      <div class="postcard-byline">
        <div class="skeleton" style="width:30px;height:30px;border-radius:999px;"></div>
        <div style="flex:1;">
          <div class="skeleton" style="width:120px;height:12px;margin-bottom:6px;"></div>
          <div class="skeleton" style="width:80px;height:10px;"></div>
        </div>
      </div>
      <div class="skeleton" style="width:80%;height:22px;margin-bottom:8px;"></div>
      <div class="skeleton" style="width:100%;height:14px;margin-bottom:6px;"></div>
      <div class="skeleton" style="width:60%;height:14px;"></div>
    </div>`).join("");
}

function emptyState(title, body){
  return `<div class="empty"><p class="empty-title">${escapeHtml(title)}</p><p class="empty-body">${escapeHtml(body)}</p></div>`;
}
function errorState(){
  return emptyState("Couldn't load posts", "Check your connection and try again in a moment.");
}

async function renderSidebar(){
  const side = $("#side");
  side.innerHTML = `
    <div class="widget" id="topWritersWidget">
      <div class="widget-head"><span class="widget-title">Who to follow</span></div>
      <div id="topWritersList">${skeletonRows(3)}</div>
    </div>
    <div class="widget">
      <div class="widget-head"><span class="widget-title">Trending topics</span></div>
      ${TOPICS.slice(0,5).map(t => `
        <div class="widget-row">
          <div style="flex:1;">
            <div class="widget-row-name">#${t}</div>
          </div>
        </div>`).join("")}
    </div>
  `;
  try{
    const writers = await fetchTopWriters(4);
    $("#topWritersList").innerHTML = writers.length ? writers.map(w => `
      <div class="widget-row">
        ${avatarHtml(w)}
        <div style="flex:1;min-width:0;">
          <div class="widget-row-name">${escapeHtml(w.name||"")}</div>
          <div class="widget-row-meta">${w.followerCount||0} followers</div>
        </div>
        <button class="btn btn-subtle btn-sm" data-guard="follow writers">Follow</button>
      </div>`).join("") : `<p class="widget-row-meta">Nobody to show yet.</p>`;
    wirePostCardEvents($("#topWritersList"));
  }catch(err){
    $("#topWritersList").innerHTML = `<p class="widget-row-meta">Couldn't load.</p>`;
  }
}

function skeletonRows(n){
  return Array.from({length:n}).map(() => `
    <div class="widget-row">
      <div class="skeleton" style="width:30px;height:30px;border-radius:999px;"></div>
      <div style="flex:1;"><div class="skeleton" style="width:70%;height:12px;"></div></div>
    </div>`).join("");
}

async function renderExplore(){
  const content = $("#content");
  content.innerHTML = `
    <h1 class="page-title">Explore</h1>
    <p class="page-sub">Trending topics, popular writers and the latest ideas on Knowbit.</p>
    <h2 class="section-title">Topics</h2>
    <div class="chip-grid">${TOPICS.map(t => `
      <a href="#/" class="topic-card"><div class="topic-card-name">${t}</div><div class="topic-card-meta">Explore posts</div></a>`).join("")}
    </div>
    <h2 class="section-title">Popular writers</h2>
    <div class="people-grid" id="explorePeople">${skeletonRows(4)}</div>
    <h2 class="section-title">Latest posts</h2>
    <div id="exploreFeed">${skeletonCards(3)}</div>
  `;
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
          <button class="btn btn-subtle btn-sm" data-guard="follow writers">Follow</button>
        </div>
      </div>`).join("") : emptyState("No writers yet", "Be the first to join and publish.");

    const authors = await fetchAuthorsFor(posts);
    const feed = $("#exploreFeed");
    feed.innerHTML = posts.length ? posts.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No posts yet", "Check back soon.");
    wirePostCardEvents(content);
  }catch(err){
    console.error(err);
    $("#explorePeople").innerHTML = errorState();
  }
}

async function renderReader(slug){
  const content = $("#content");
  content.innerHTML = `<div style="padding:40px 0;">${skeletonCards(1)}</div>`;
  $("#side").innerHTML = "";

  const post = await fetchPostBySlug(decodeURIComponent(slug)).catch(() => null);
  if (!post){
    content.innerHTML = emptyState("Post not found", "It may have been removed, or the link is incorrect.");
    return;
  }
  const authorSnap = post.authorId ? await getDoc(doc(db, "users", post.authorId)) : null;
  const author = authorSnap && authorSnap.exists() ? { id: authorSnap.id, ...authorSnap.data() } : {};
  const mins = post.readingTime || readingTime(post.content || "");

  content.innerHTML = `
    <div class="reader-meta">${post.topic ? `<span class="topic-chip">${escapeHtml(post.topic)}</span>` : ""}</div>
    <h1 class="reader-title">${escapeHtml(post.title||"Untitled")}</h1>
    <div class="reader-byline">
      ${avatarHtml(author)}
      <div class="reader-byline-info">
        <div class="byline-name"><a href="#/@${escapeHtml(author.username||"")}">${escapeHtml(author.name||"Unknown")}</a></div>
        <div class="byline-meta">${timeAgo(post.createdAt)} &middot; ${mins} min read</div>
      </div>
      <button class="btn btn-primary btn-sm" data-guard="follow this writer">Follow</button>
    </div>
    <div class="reader-body">${paragraphsToHtml(post.content||"")}</div>
    <div class="reader-actions">
      <button class="postcard-stat" data-guard="like this post">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 20s-7.5-4.6-9.8-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.8 5c-2.3 4.4-9.8 9-9.8 9Z"/></svg>
        ${post.likeCount||0} Like
      </button>
      <button class="postcard-stat" data-guard="bookmark this post">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
        Save
      </button>
      <button class="postcard-stat" data-share="${escapeHtml(post.slug||post.id)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.1 10.7 15.9 6.3M8.1 13.3l7.8 4.4"/></svg>
        Share
      </button>
    </div>

    <div class="author-box">
      ${avatarHtml(author, "lg")}
      <div class="author-box-body">
        <div class="author-box-name">${escapeHtml(author.name||"Unknown")}</div>
        <p class="author-box-bio">${escapeHtml(author.bio||"No bio yet.")}</p>
        <div class="author-box-stats"><b>${author.followerCount||0}</b> followers &middot; <b>${author.followingCount||0}</b> following</div>
        <button class="btn btn-primary btn-sm" data-guard="follow this writer">Follow</button>
      </div>
    </div>

    <h2 class="comments-head">Comments</h2>
    <div id="commentsList">${skeletonRows(2)}</div>
    <div style="margin-top:16px;">
      <button class="btn btn-subtle btn-block" data-guard="join the discussion">Add a comment</button>
    </div>
  `;
  wirePostCardEvents(content);

  try{
    const comments = await fetchCommentsForPost(post.id);
    const top = comments.filter(c => !c.parentId);
    $("#commentsList").innerHTML = top.length ? top.map(c => commentHtml(c, comments)).join("") : emptyState("No comments yet", "Be the first to share your thoughts.");
  }catch{
    $("#commentsList").innerHTML = errorState();
  }
}

function commentHtml(c, all){
  const replies = all.filter(r => r.parentId === c.id);
  return `
  <div class="comment">
    ${avatarHtml({ name: c.authorName })}
    <div class="comment-body">
      <div class="comment-bubble">
        <div class="comment-author">${escapeHtml(c.authorName||"Someone")}</div>
        <div class="comment-text">${escapeHtml(c.text||"")}</div>
      </div>
      <div class="comment-actions">
        <button class="comment-action" data-guard="like this comment">Like ${c.likeCount?`(${c.likeCount})`:""}</button>
        <button class="comment-action" data-guard="reply to this comment">Reply</button>
        <span class="comment-action">${timeAgo(c.createdAt)}</span>
      </div>
      ${replies.length ? `<div class="comment-replies">${replies.map(r => commentHtml(r, all)).join("")}</div>` : ""}
    </div>
  </div>`;
}

async function renderProfile(username){
  const content = $("#content");
  content.innerHTML = skeletonRows(1) + skeletonCards(2);
  $("#side").innerHTML = "";

  const user = await fetchUserByUsername(decodeURIComponent(username)).catch(() => null);
  if (!user){
    content.innerHTML = emptyState("Profile not found", "This user doesn't exist or their account was removed.");
    return;
  }
  content.innerHTML = `
    <div class="profile-head">
      ${avatarHtml(user, "xl")}
      <div>
        <div class="profile-name">${escapeHtml(user.name||"")}</div>
        <div class="profile-handle">@${escapeHtml(user.username||"")}</div>
        <p class="profile-bio">${escapeHtml(user.bio||"No bio yet.")}</p>
        <div class="profile-stats">
          <span><b>${user.postCount||0}</b> Posts</span>
          <span><b>${user.followerCount||0}</b> Followers</span>
          <span><b>${user.followingCount||0}</b> Following</span>
        </div>
      </div>
    </div>
    <button class="btn btn-primary" data-guard="follow this writer" style="margin-bottom:22px;">Follow</button>
    <h2 class="section-title">Posts</h2>
    <div id="profilePosts">${skeletonCards(2)}</div>
  `;
  wirePostCardEvents(content);

  try{
    const posts = await fetchPostsByAuthor(user.id, 20);
    $("#profilePosts").innerHTML = posts.length ? posts.map(p => postCardHtml(p, user)).join("") : emptyState("No posts yet", `@${user.username} hasn't published anything yet.`);
    wirePostCardEvents($("#profilePosts"));
  }catch{
    $("#profilePosts").innerHTML = errorState();
  }
}

/* ============================== search ============================== */

$("#searchForm").addEventListener("submit", e => {
  e.preventDefault();
  const term = $("#searchInput").value.trim().toLowerCase();
  if (!term) return;
  renderSearch(term);
});

function renderSearch(term){
  location.hash = "#/search/" + encodeURIComponent(term);
}

async function renderSearchResults(term){
  const content = $("#content");
  content.innerHTML = `<h1 class="page-title">Results for "${escapeHtml(term)}"</h1><div id="searchResults">${skeletonCards(3)}</div>`;
  $("#side").innerHTML = "";
  const t = decodeURIComponent(term).toLowerCase();
  try{
    const posts = await fetchPublishedPosts("createdAt", 50);
    const matches = posts.filter(p => (p.title||"").toLowerCase().includes(t) || (p.topic||"").toLowerCase().includes(t));
    const authors = await fetchAuthorsFor(matches);
    $("#searchResults").innerHTML = matches.length ? matches.map(p => postCardHtml(p, authors[p.authorId]||{})).join("") : emptyState("No results", "Try a different search term.");
    wirePostCardEvents(content);
  }catch{
    $("#searchResults").innerHTML = errorState();
  }
}

/* ============================== router ============================== */

const routes = [
  { test: h => h === "" || h === "#/" || h === "#/home", run: renderHome, name: "home" },
  { test: h => h === "#/explore", run: renderExplore, name: "explore" },
  { test: h => h.startsWith("#/post/"), run: () => renderReader(h().split("#/post/")[1]) },
  { test: h => h.startsWith("#/@"), run: () => renderProfile(h().split("#/@")[1]) },
  { test: h => h.startsWith("#/search/"), run: () => renderSearchResults(h().split("#/search/")[1]) },
];
function h(){ return location.hash; }

function updateNavActive(){
  const current = location.hash;
  const routeName = (current === "" || current === "#/" || current === "#/home") ? "home"
    : current === "#/explore" ? "explore" : "";
  $$("[data-route]").forEach(el => el.classList.toggle("is-active", el.dataset.route === routeName));
}

function router(){
  const hash = location.hash;
  const match = routes.find(r => r.test(hash)) || routes[0];
  $("#content").scrollIntoView({ block: "start", behavior: "instant" });
  window.scrollTo(0, 0);
  match.run();
  updateNavActive();
}

window.addEventListener("hashchange", router);
router();
renderRailTopics();

function renderRailTopics(){
  $("#railTopics").innerHTML = TOPICS.slice(0,6).map(t => `<a href="#/" class="rail-topic"><span>${t}</span></a>`).join("");
}
