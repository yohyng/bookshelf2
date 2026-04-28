import React, { useEffect, useMemo, useRef, useState } from "react";

const ENV = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
const SUPABASE_URL = ENV.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = ENV.VITE_SUPABASE_ANON_KEY || "";
const HAS_SUPABASE_CONFIG = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const SESSION_KEY = "shiori_supabase_session_v1";
const LOCAL_BOOKS_KEY = "shiori_local_books_v1";
const THEME_KEY = "shiori_theme_v1";
const HIGHLIGHT_ROTATION_MS = 5 * 60 * 1000;

const sampleBooks = [
  {
    id: "book-1",
    title: "ありふれたものの変容",
    author: "アーサー・C・ダントー",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    quotes: [
      {
        id: "quote-1",
        transcription: "芸術作品であることは、物質的な属性だけではなく、**それを読み解く文脈**によって成立する。",
        pageNumber: "42",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
      },
      {
        id: "quote-2",
        transcription: "同じ“もの”であっても、置かれる枠組みによって意味は一変する。",
        pageNumber: "87",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      },
    ],
  },
  {
    id: "book-2",
    title: "普通のデザイン",
    author: "内田繁",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    quotes: [
      {
        id: "quote-3",
        transcription: "日本の室内の特性は、**空なる場**である。必要に応じて、さまざまな変化がつくり出される。",
        pageNumber: "128",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
      },
    ],
  },
];

function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function readInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function flattenQuotes(books) {
  return books.flatMap((book) =>
    (book.quotes || []).map((quote) => ({
      ...quote,
      bookId: book.id,
      bookTitle: book.title,
      bookAuthor: book.author,
    }))
  );
}

function pickNextQuote(quotes, currentId) {
  if (quotes.length === 0) return null;
  if (quotes.length === 1) return quotes[0];
  const candidates = quotes.filter((quote) => quote.id !== currentId);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function toCamelBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    quotes: [],
  };
}

function toCamelQuote(row) {
  return {
    id: row.id,
    bookId: row.book_id,
    transcription: row.transcription,
    pageNumber: row.page_number || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groupBooksAndQuotes(bookRows, quoteRows) {
  const books = bookRows.map(toCamelBook);
  const byId = new Map(books.map((book) => [book.id, book]));
  quoteRows.map(toCamelQuote).forEach((quote) => {
    const book = byId.get(quote.bookId);
    if (book) book.quotes.push(quote);
  });
  books.forEach((book) => book.quotes.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  return books;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildCSV(books) {
  let csv = "\uFEFFBook Title,Author,Page,Quote,Created At\n";
  books.forEach((book) => {
    (book.quotes || []).forEach((quote) => {
      csv += [
        book.title,
        book.author || "",
        quote.pageNumber || "",
        (quote.transcription || "").replace(/\*\*/g, ""),
        new Date(quote.createdAt).toLocaleString(),
      ].map(csvEscape).join(",") + "\n";
    });
  });
  return csv;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return headers.reduce((row, header, i) => ({ ...row, [header]: values[i] ?? "" }), {});
  });
}

function getFirstValue(row, keys) {
  const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const key of keys) {
    const value = normalized[key.toLowerCase()];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizeImportedRows(rows) {
  return rows
    .map((row) => ({
      title: getFirstValue(row, ["Book Title", "Title", "book", "書名", "タイトル", "本"]),
      author: getFirstValue(row, ["Author", "著者", "作者"]),
      pageNumber: getFirstValue(row, ["Page", "page", "pageNumber", "page_number", "ページ", "頁"]),
      transcription: getFirstValue(row, ["Quote", "Transcription", "Text", "Body", "本文", "引用", "抜粋", "メモ"]),
      createdAt: getFirstValue(row, ["Created At", "created_at", "createdAt", "Date", "日付", "作成日"]),
    }))
    .filter((row) => row.title && row.transcription);
}

function safeDateISOString(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toggleMarkdownBold(text, start, end) {
  if (start === end) return text;
  const selected = text.substring(start, end);
  const wrapped = selected.startsWith("**") && selected.endsWith("**") ? selected.slice(2, -2) : `**${selected}**`;
  return text.substring(0, start) + wrapped + text.substring(end);
}

async function supabaseAuthFetch(path, body, token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.msg || data.message || "Supabase Auth error");
  return data;
}

async function supabaseDbFetch(path, { method = "GET", token, body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.hint || "Supabase database error");
  return data;
}

function readLocalBooks() {
  try {
    const stored = localStorage.getItem(LOCAL_BOOKS_KEY);
    return stored ? JSON.parse(stored) : sampleBooks;
  } catch {
    return sampleBooks;
  }
}

function writeLocalBooks(books) {
  localStorage.setItem(LOCAL_BOOKS_KEY, JSON.stringify(books));
}

function Icon({ children, className = "w-5 h-5" }) {
  return <span className={`inline-flex items-center justify-center ${className}`}>{children}</span>;
}

function Toast({ statusMsg }) {
  return (
    <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${statusMsg.type === "error" ? "bg-red-600 text-white" : "bg-slate-900 text-white"}`}>
      <span>{statusMsg.type === "error" ? "⚠️" : "✅"}</span>
      <span className="text-xs font-bold">{statusMsg.text}</span>
    </div>
  );
}

function ThemeButton({ theme, toggleTheme, isDark }) {
  return (
    <button
      onClick={toggleTheme}
      className={`${isDark ? "bg-slate-800 text-amber-300 hover:bg-slate-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"} p-2 rounded-2xl transition-colors`}
      aria-label={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

export default function App() {
  const [view, setView] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState(readInitialTheme);

  const fileInputRef = useRef(null);
  const csvInputRef = useRef(null);
  const textareaRef = useRef(null);

  const [selectedBookId, setSelectedBookId] = useState("new");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [transcription, setTranscription] = useState("");
  const [pageNumber, setPageNumber] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [dailyQuote, setDailyQuote] = useState(null);

  const isDark = theme === "dark";
  const isLocalDemo = !HAS_SUPABASE_CONFIG;
  const accessToken = session?.access_token;
  const allQuotes = useMemo(() => flattenQuotes(books), [books]);
  const selectedBookLive = useMemo(() => selectedBook ? books.find((b) => b.id === selectedBook.id) || selectedBook : null, [books, selectedBook]);

  const ui = {
    app: isDark ? "bg-slate-950 text-slate-100 selection:bg-indigo-900" : "bg-[#FDFDFF] text-slate-900 selection:bg-indigo-100",
    header: isDark ? "bg-slate-950/75 border-slate-800/80" : "bg-white/70 border-slate-100/50",
    panel: isDark ? "bg-slate-900 border-slate-800 shadow-black/25" : "bg-white border-slate-100 shadow-indigo-100/40",
    soft: isDark ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-100",
    muted: isDark ? "text-slate-400" : "text-slate-400",
    subtle: isDark ? "text-slate-500" : "text-slate-300",
    title: isDark ? "text-slate-50" : "text-slate-900",
    body: isDark ? "text-slate-200" : "text-slate-800",
    input: isDark ? "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-indigo-400" : "bg-slate-50 border-slate-50 text-slate-900 placeholder:text-slate-200 focus:border-indigo-500",
    highlight: isDark ? "bg-indigo-950 text-indigo-100 border-indigo-700" : "bg-indigo-50 text-indigo-900 border-indigo-200",
    nav: isDark ? "bg-white/90 border-slate-300" : "bg-slate-900/90 border-white/10",
    navInactive: isDark ? "text-slate-500 hover:text-slate-900" : "text-slate-500 hover:text-slate-300",
    navActive: isDark ? "bg-slate-950 text-white shadow-xl" : "bg-white text-slate-900 shadow-xl",
  };

  useEffect(() => {
    console.assert(parseCSV("Book Title,Author,Page,Quote\nA,B,1,C").length === 1, "CSV parser test failed");
    console.assert(toggleMarkdownBold("abc", 0, 3) === "**abc**", "highlight test failed");
    if (isLocalDemo) {
      setBooks(readLocalBooks());
      setSession({ user: { email: "local-demo@shiori" }, access_token: "local-demo" });
      return;
    }
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) setSession(JSON.parse(stored));
  }, [isLocalDemo]);

  useEffect(() => localStorage.setItem(THEME_KEY, theme), [theme]);
  useEffect(() => { if (isLocalDemo) writeLocalBooks(books); }, [books, isLocalDemo]);
  useEffect(() => { if (accessToken && !isLocalDemo) fetchBooks(); }, [accessToken, isLocalDemo]);

  useEffect(() => {
    if (allQuotes.length === 0) {
      setDailyQuote(null);
      return;
    }
    setDailyQuote((current) => current && allQuotes.some((q) => q.id === current.id) ? current : allQuotes[0]);
  }, [allQuotes]);

  useEffect(() => {
    if (allQuotes.length === 0) return undefined;
    const intervalId = window.setInterval(() => {
      setDailyQuote((current) => pickNextQuote(allQuotes, current?.id));
    }, HIGHLIGHT_ROTATION_MS);
    return () => window.clearInterval(intervalId);
  }, [allQuotes]);

  const showStatus = (text, type = "success") => {
    setStatusMsg({ text, type });
    if (type !== "error") window.setTimeout(() => setStatusMsg(null), 2500);
  };

  async function fetchBooks() {
    setLoading(true);
    try {
      const [bookRows, quoteRows] = await Promise.all([
        supabaseDbFetch("books?select=*&order=updated_at.desc", { token: accessToken }),
        supabaseDbFetch("quotes?select=*&order=created_at.asc", { token: accessToken }),
      ]);
      setBooks(groupBooksAndQuotes(bookRows || [], quoteRows || []));
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) return showStatus("メールアドレスとパスワードを入力してください", "error");
    setLoading(true);
    try {
      const data = authMode === "signup"
        ? await supabaseAuthFetch("signup", { email, password })
        : await supabaseAuthFetch("token?grant_type=password", { email, password });
      if (!data.access_token) return showStatus("登録確認メールを確認してください。確認後にログインできます。", "success");
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      setSession(data);
      setEmail("");
      setPassword("");
      showStatus(authMode === "signup" ? "登録しました" : "ログインしました");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setBooks([]);
    setSelectedBook(null);
    setDailyQuote(null);
    setView("dashboard");
  };

  const pickRandomQuote = () => {
    if (allQuotes.length === 0) return;
    setDailyQuote((current) => pickNextQuote(allQuotes, current?.id));
    showStatus("新しいハイライトを表示しました");
  };

  const handleFileSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedBookId("new");
    setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    setAuthor("");
    setPageNumber("");
    setTranscription("画像は保存しません。OCR後のテキスト、または手入力した本文だけをSupabaseに保存します。");
    setEditingQuoteId(null);
    setView("add");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCSVImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const rows = normalizeImportedRows(parseCSV(await file.text()));
      if (rows.length === 0) throw new Error("インポートできる行が見つかりませんでした");
      if (isLocalDemo) importRowsLocally(rows);
      else {
        await importRowsToSupabase(rows);
        await fetchBooks();
      }
      showStatus(`${rows.length}件のハイライトをインポートしました`);
      setView("library");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  function importRowsLocally(rows) {
    const now = new Date().toISOString();
    setBooks((prev) => {
      const next = prev.map((book) => ({ ...book, quotes: [...(book.quotes || [])] }));
      const byKey = new Map(next.map((book) => [`${book.title.trim().toLowerCase()}|${(book.author || "").trim().toLowerCase()}`, book]));
      rows.forEach((row) => {
        const key = `${row.title.trim().toLowerCase()}|${(row.author || "").trim().toLowerCase()}`;
        let book = byKey.get(key);
        if (!book) {
          book = { id: uid("book"), title: row.title, author: row.author, createdAt: now, updatedAt: now, quotes: [] };
          byKey.set(key, book);
          next.unshift(book);
        }
        book.quotes.push({ id: uid("quote"), transcription: row.transcription, pageNumber: row.pageNumber, createdAt: safeDateISOString(row.createdAt), updatedAt: now });
        book.updatedAt = now;
      });
      return next;
    });
  }

  async function importRowsToSupabase(rows) {
    const now = new Date().toISOString();
    const existingBooks = new Map(books.map((book) => [`${book.title.trim().toLowerCase()}|${(book.author || "").trim().toLowerCase()}`, book.id]));
    for (const row of rows) {
      const key = `${row.title.trim().toLowerCase()}|${(row.author || "").trim().toLowerCase()}`;
      let bookId = existingBooks.get(key);
      if (!bookId) {
        const inserted = await supabaseDbFetch("books", { method: "POST", token: accessToken, body: { title: row.title, author: row.author, updated_at: now }, prefer: "return=representation" });
        bookId = inserted?.[0]?.id;
        existingBooks.set(key, bookId);
      }
      await supabaseDbFetch("quotes", { method: "POST", token: accessToken, body: { book_id: bookId, transcription: row.transcription, page_number: row.pageNumber, created_at: safeDateISOString(row.createdAt), updated_at: now }, prefer: "return=minimal" });
      await supabaseDbFetch(`books?id=eq.${bookId}`, { method: "PATCH", token: accessToken, body: { updated_at: now }, prefer: "return=minimal" });
    }
  }

  const saveQuote = async () => {
    if (!transcription.trim()) return showStatus("本文を入力してください", "error");
    setLoading(true);
    try {
      if (isLocalDemo) {
        saveQuoteLocally();
        return;
      }
      const now = new Date().toISOString();
      if (editingQuoteId) {
        await supabaseDbFetch(`quotes?id=eq.${editingQuoteId}`, { method: "PATCH", token: accessToken, body: { transcription, page_number: pageNumber, updated_at: now }, prefer: "return=minimal" });
        await supabaseDbFetch(`books?id=eq.${selectedBookId}`, { method: "PATCH", token: accessToken, body: { updated_at: now }, prefer: "return=minimal" });
        showStatus("編集を保存しました");
        setView("book-detail");
      } else {
        let bookId = selectedBookId;
        if (selectedBookId === "new") {
          if (!title.trim()) throw new Error("書名を入力してください");
          const inserted = await supabaseDbFetch("books", { method: "POST", token: accessToken, body: { title, author }, prefer: "return=representation" });
          bookId = inserted?.[0]?.id;
        }
        await supabaseDbFetch("quotes", { method: "POST", token: accessToken, body: { book_id: bookId, transcription, page_number: pageNumber }, prefer: "return=representation" });
        await supabaseDbFetch(`books?id=eq.${bookId}`, { method: "PATCH", token: accessToken, body: { updated_at: now }, prefer: "return=minimal" });
        showStatus("保存しました");
        setView("dashboard");
      }
      setTranscription("");
      setPageNumber("");
      setEditingQuoteId(null);
      await fetchBooks();
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  function saveQuoteLocally() {
    const now = new Date().toISOString();
    if (editingQuoteId) {
      setBooks((prev) => prev.map((book) => book.id === selectedBookId ? { ...book, updatedAt: now, quotes: book.quotes.map((q) => q.id === editingQuoteId ? { ...q, transcription, pageNumber, updatedAt: now } : q) } : book));
      setView("book-detail");
    } else {
      const newQuote = { id: uid("quote"), transcription, pageNumber, createdAt: now, updatedAt: now };
      if (selectedBookId === "new") {
        if (!title.trim()) throw new Error("書名を入力してください");
        const newBook = { id: uid("book"), title, author, quotes: [newQuote], createdAt: now, updatedAt: now };
        setBooks((prev) => [newBook, ...prev]);
        setDailyQuote({ ...newQuote, bookId: newBook.id, bookTitle: newBook.title, bookAuthor: newBook.author });
      } else {
        setBooks((prev) => prev.map((book) => book.id === selectedBookId ? { ...book, quotes: [...book.quotes, newQuote], updatedAt: now } : book));
      }
      setView("dashboard");
    }
    setTranscription("");
    setPageNumber("");
    setEditingQuoteId(null);
    setLoading(false);
    showStatus("保存しました");
  }

  const deleteQuote = async (bookId, quoteId) => {
    setLoading(true);
    try {
      if (isLocalDemo) setBooks((prev) => prev.map((book) => book.id === bookId ? { ...book, quotes: book.quotes.filter((q) => q.id !== quoteId) } : book));
      else {
        await supabaseDbFetch(`quotes?id=eq.${quoteId}`, { method: "DELETE", token: accessToken, prefer: "return=minimal" });
        await fetchBooks();
      }
      showStatus("メモを削除しました");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const deleteBook = async (bookId) => {
    setLoading(true);
    try {
      if (isLocalDemo) setBooks((prev) => prev.filter((book) => book.id !== bookId));
      else {
        await supabaseDbFetch(`books?id=eq.${bookId}`, { method: "DELETE", token: accessToken, prefer: "return=minimal" });
        await fetchBooks();
      }
      setSelectedBook(null);
      setView("library");
      showStatus("本を削除しました");
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const applyHighlight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (textarea.selectionStart === textarea.selectionEnd) return showStatus("ハイライトしたい範囲を選択してください", "error");
    setTranscription(toggleMarkdownBold(transcription, textarea.selectionStart, textarea.selectionEnd));
  };

  const startEditQuote = (book, quote) => {
    setSelectedBook(book);
    setSelectedBookId(book.id);
    setTranscription(quote.transcription);
    setPageNumber(quote.pageNumber || "");
    setEditingQuoteId(quote.id);
    setView("add");
  };

  const exportToCSV = () => {
    if (books.length === 0) return;
    const blob = new Blob([buildCSV(books)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shiori_export_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderFormattedText = (text, size = "text-xl") => {
    const parts = (text || "").split(/(\*\*.*?\*\*)/g);
    return (
      <p className={`${size} font-serif leading-relaxed ${ui.body} whitespace-pre-wrap`}>
        {parts.map((part, i) => part.startsWith("**") && part.endsWith("**") ? (
          <span key={i} className={`${ui.highlight} font-bold border-b-2 px-1`}>{part.slice(2, -2)}</span>
        ) : <span key={i}>{part}</span>)}
      </p>
    );
  };

  if (!session) {
    return (
      <div className={`min-h-screen ${ui.app} font-sans flex items-center justify-center p-6 transition-colors duration-300`}>
        {statusMsg && <Toast statusMsg={statusMsg} />}
        <div className={`w-full max-w-md ${ui.panel} rounded-[3rem] p-8 shadow-2xl border space-y-6`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-900/20">🔖</div>
              <div>
                <h1 className={`text-2xl font-black italic tracking-tighter uppercase ${ui.title}`}>Shiori</h1>
                <p className={`text-xs font-bold ${ui.muted} uppercase tracking-widest`}>Supabase Text DB</p>
              </div>
            </div>
            <ThemeButton theme={theme} toggleTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")} isDark={isDark} />
          </div>

          {!HAS_SUPABASE_CONFIG && (
            <div className="bg-amber-50 border border-amber-100 text-amber-700 rounded-2xl p-4 text-xs font-bold leading-relaxed">
              VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY が未設定です。Local Demoとして動作します。
            </div>
          )}

          <div className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={`w-full px-5 py-4 rounded-2xl border-2 outline-none font-bold text-sm ${ui.input}`} placeholder="email@example.com" />
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={`w-full px-5 py-4 rounded-2xl border-2 outline-none font-bold text-sm ${ui.input}`} placeholder="password" />
          </div>

          <button onClick={handleAuth} disabled={loading} className="w-full bg-indigo-600 text-white py-5 rounded-[2rem] font-black shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50">
            {loading ? "読み込み中..." : authMode === "signin" ? "ログイン" : "新規登録"}
          </button>
          <button onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")} className="w-full text-xs font-black text-indigo-500 uppercase tracking-widest">
            {authMode === "signin" ? "アカウントを作成する" : "ログインに戻る"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${ui.app} pb-36 font-sans transition-colors duration-300`}>
      {statusMsg && <Toast statusMsg={statusMsg} />}

      <header className={`${ui.header} backdrop-blur-xl sticky top-0 z-30 px-6 py-5 flex justify-between items-center border-b transition-colors duration-300`}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-900/20">🔖</div>
          <div>
            <h1 className={`text-xl font-black italic tracking-tighter uppercase leading-none ${ui.title}`}>Shiori</h1>
            <p className={`text-[9px] font-black ${ui.subtle} uppercase tracking-widest mt-1`}>{isLocalDemo ? "Local Demo" : "Supabase"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeButton theme={theme} toggleTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")} isDark={isDark} />
          <button onClick={pickRandomQuote} className={`${ui.muted} p-2 hover:text-indigo-500 transition-colors`} aria-label="新しいハイライトを表示">🔄</button>
          {!isLocalDemo && <button onClick={logout} className={`${ui.muted} p-2 hover:text-red-500 transition-colors`} aria-label="ログアウト">↪</button>}
        </div>
      </header>

      <main className="max-w-xl mx-auto p-6">
        {isLocalDemo && (
          <div className="mb-6 bg-amber-50 border border-amber-100 text-amber-700 rounded-3xl p-5 text-xs font-bold leading-relaxed">
            Supabase環境変数が未設定のため、現在はブラウザ内のLocal Demoに保存しています。
          </div>
        )}

        {view === "dashboard" && (
          <div className="space-y-10">
            <section className="space-y-6">
              <div className="flex items-center justify-between px-1">
                <h2 className={`text-2xl font-black italic ${ui.title}`}>ハイライト</h2>
                <span className={`text-[10px] font-black ${ui.subtle} uppercase tracking-widest ${ui.soft} border px-3 py-1 rounded-full`}>Auto / 5 min</span>
              </div>
              {dailyQuote ? (
                <div className={`group relative ${ui.panel} rounded-[3rem] p-10 shadow-2xl border min-h-[420px] flex flex-col justify-between transition-all hover:scale-[1.01]`}>
                  <div className="space-y-6">
                    <Icon className="w-8 h-8 text-indigo-300">✨</Icon>
                    {renderFormattedText(dailyQuote.transcription, "text-2xl")}
                  </div>
                  <div className={`mt-12 pt-8 border-t ${isDark ? "border-slate-800" : "border-slate-100"} flex justify-between items-end`}>
                    <div className="max-w-[70%]">
                      <h3 className={`text-xl font-black ${ui.title} leading-tight`}>{dailyQuote.bookTitle}</h3>
                      <p className="text-xs font-bold text-indigo-500 mt-1.5 uppercase tracking-wider">{dailyQuote.bookAuthor || "Unknown Author"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => {
                        const book = books.find((item) => item.id === dailyQuote.bookId);
                        if (book) startEditQuote(book, dailyQuote);
                      }} className={`${ui.soft} p-3 ${ui.muted} rounded-2xl hover:text-indigo-500 transition-colors`} aria-label="引用を編集">✎</button>
                      <span className={`text-sm font-mono font-bold ${ui.subtle} italic`}>p.{dailyQuote.pageNumber}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`h-72 flex flex-col items-center justify-center ${ui.soft} border-2 border-dashed rounded-[3rem] ${ui.subtle} group hover:border-indigo-300 transition-all`}>
                  <p className="text-4xl mb-4 opacity-40">📚</p>
                  <p className="font-bold text-[10px] tracking-widest uppercase">本を一冊、記録しましょう</p>
                </div>
              )}
            </section>

            <section className="space-y-6">
              <h2 className={`text-lg font-black italic px-1 ${ui.title}`}>最近の記録</h2>
              <div className="space-y-3">
                {books.slice(0, 3).map((book) => (
                  <button key={book.id} onClick={() => { setSelectedBook(book); setView("book-detail"); }} className={`w-full ${ui.panel} p-5 rounded-3xl border flex items-center gap-4 text-left hover:shadow-lg transition-all active:scale-95`}>
                    <div className={`${isDark ? "bg-indigo-950 text-indigo-200" : "bg-indigo-50 text-indigo-600"} w-12 h-12 rounded-2xl flex items-center justify-center shrink-0`}>📖</div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-black text-sm truncate ${ui.title}`}>{book.title}</h4>
                      <p className={`text-[10px] font-bold ${ui.muted} mt-0.5`}>{book.quotes?.length || 0} highlights</p>
                    </div>
                    <span className={ui.subtle}>›</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {view === "library" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 className={`text-3xl font-black italic ${ui.title}`}>本棚</h2>
              <div className="flex items-center gap-2">
                <label className={`${ui.panel} flex items-center gap-2 px-4 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest ${ui.muted} hover:text-indigo-500 transition-all shadow-sm cursor-pointer`}>
                  ⬆ Import CSV
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCSVImport} />
                </label>
                <button onClick={exportToCSV} className={`${ui.panel} flex items-center gap-2 px-4 py-2 rounded-2xl border text-[10px] font-black uppercase tracking-widest ${ui.muted} hover:text-indigo-500 transition-all shadow-sm`}>⬇ Export CSV</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {books.length > 0 ? books.map((book) => (
                <div key={book.id} onClick={() => { setSelectedBook(book); setView("book-detail"); }} className={`${ui.panel} p-6 rounded-[2.5rem] shadow-sm border group hover:border-indigo-300 hover:shadow-xl transition-all cursor-pointer`}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1 pr-4">
                      <h3 className={`font-black text-xl ${ui.title} group-hover:text-indigo-500 transition-colors`}>{book.title}</h3>
                      <p className={`text-xs font-bold ${ui.muted} mt-1 uppercase tracking-wider`}>{book.author || "Unknown Author"}</p>
                    </div>
                    <div className={`${ui.soft} px-3 py-2 rounded-2xl text-center border`}>
                      <span className={`block text-lg font-black ${ui.title} leading-none`}>{book.quotes?.length || 0}</span>
                      <span className={`text-[8px] font-black ${ui.muted} uppercase tracking-tighter`}>Notes</span>
                    </div>
                  </div>
                </div>
              )) : <Empty ui={ui} />}
            </div>
          </div>
        )}

        {view === "book-detail" && selectedBookLive && (
          <div className="space-y-8">
            <button onClick={() => setView("library")} className={`flex items-center gap-2 ${ui.muted} hover:text-indigo-500 transition-colors`}><span>‹</span><span className="text-xs font-black uppercase tracking-widest">Back to Library</span></button>
            <div className="flex justify-between items-end px-2">
              <div className="max-w-[80%]">
                <h2 className={`text-3xl font-black ${ui.title} italic leading-tight`}>{selectedBookLive.title}</h2>
                <p className="text-sm font-bold text-indigo-500 mt-2 uppercase tracking-widest">{selectedBookLive.author || "Unknown Author"}</p>
              </div>
              <button onClick={() => deleteBook(selectedBookLive.id)} className={`${ui.subtle} p-3 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all`}>🗑</button>
            </div>
            <div className="space-y-6 mt-10">
              {selectedBookLive.quotes?.slice().reverse().map((quote) => (
                <div key={quote.id} className={`${ui.panel} p-8 rounded-[2.5rem] border shadow-sm relative overflow-hidden group`}>
                  <div className="relative">
                    <div className={`flex items-center gap-3 mb-6 ${ui.subtle}`}>
                      <span>🕘</span>
                      <span className="text-[10px] font-bold font-mono">{new Date(quote.createdAt).toLocaleDateString()}</span>
                      <span className={`${ui.soft} text-[10px] font-bold ml-auto px-2 py-1 rounded-lg border`}>p.{quote.pageNumber}</span>
                    </div>
                    {renderFormattedText(quote.transcription, "text-lg")}
                    <div className="mt-8 flex items-center gap-2 justify-end opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEditQuote(selectedBookLive, quote)} className={`${ui.soft} p-3 ${ui.muted} rounded-2xl hover:text-indigo-500 transition-all`}>✎</button>
                      <button onClick={() => deleteQuote(selectedBookLive.id, quote.id)} className={`${ui.soft} p-3 ${ui.muted} rounded-2xl hover:text-red-500 transition-all`}>🗑</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "add" && (
          <div className="space-y-6 pb-12">
            <div className="flex items-center gap-4 px-1">
              <button onClick={() => { setView(editingQuoteId ? "book-detail" : "dashboard"); setEditingQuoteId(null); setTranscription(""); setPageNumber(""); }} className={`${ui.panel} p-3 border rounded-2xl shadow-sm ${ui.muted}`}>‹</button>
              <h2 className={`text-xl font-black italic ${ui.title}`}>{editingQuoteId ? "内容を編集" : "記録を確認"}</h2>
            </div>
            <div className={`${ui.panel} p-8 rounded-[3rem] shadow-2xl border space-y-8`}>
              {!editingQuoteId && (
                <div className="space-y-4">
                  <select value={selectedBookId} onChange={(e) => setSelectedBookId(e.target.value)} className={`w-full p-5 rounded-2xl border-2 font-bold text-sm outline-none transition-all cursor-pointer ${ui.input}`}>
                    <option value="new">+ 新しい本として登録</option>
                    {books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}
                  </select>
                  {selectedBookId === "new" && (
                    <div className="space-y-3">
                      <LabeledInput label="Book Title" value={title} onChange={setTitle} placeholder="書名" ui={ui} />
                      <LabeledInput label="Author" value={author} onChange={setAuthor} placeholder="著者" ui={ui} />
                    </div>
                  )}
                </div>
              )}
              <LabeledInput label="Page" value={pageNumber} onChange={setPageNumber} placeholder="ページ番号" ui={ui} />
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <label className={`text-[10px] font-black ${ui.muted} uppercase tracking-widest`}>Transcription</label>
                  <button onClick={applyHighlight} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-full text-[11px] font-black shadow-lg shadow-indigo-900/20 active:scale-95 transition-all">ハイライト</button>
                </div>
                <textarea ref={textareaRef} value={transcription} onChange={(e) => setTranscription(e.target.value)} className={`w-full px-8 py-8 rounded-[2.5rem] border-2 h-80 outline-none font-serif leading-relaxed text-lg resize-none shadow-inner transition-all ${ui.input}`} placeholder="読み取り内容、または引用文を入力" />
              </div>
              <button onClick={saveQuote} disabled={loading} className="w-full bg-indigo-600 text-white py-6 rounded-[2rem] font-black shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50">
                {loading ? "保存中..." : editingQuoteId ? "編集内容を適用" : "保存する"}
              </button>
            </div>
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 px-8 pb-10 pt-4 z-40 flex justify-center pointer-events-none">
        <div className={`${ui.nav} backdrop-blur-2xl border rounded-[3rem] shadow-2xl flex justify-between items-center px-6 py-4 pointer-events-auto max-w-sm w-full`}>
          <button onClick={() => setView("dashboard")} className={`p-4 rounded-[2rem] transition-all ${view === "dashboard" ? ui.navActive : ui.navInactive}`}>▦</button>
          <div className="relative -top-12">
            <label className={`w-20 h-20 bg-indigo-600 rounded-[2.5rem] flex items-center justify-center text-white shadow-2xl shadow-indigo-500/40 cursor-pointer active:scale-90 transition-all border-4 ${isDark ? "border-slate-950" : "border-[#FDFDFF]"}`}>
              📷
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </label>
          </div>
          <button onClick={() => setView("library")} className={`p-4 rounded-[2rem] transition-all ${view === "library" || view === "book-detail" ? ui.navActive : ui.navInactive}`}>📚</button>
        </div>
      </nav>

      {loading && (
        <div className={`fixed inset-0 ${isDark ? "bg-slate-950/80" : "bg-white/80"} backdrop-blur-md z-[60] flex flex-col items-center justify-center`}>
          <div className="text-4xl animate-pulse">✨</div>
          <p className={`mt-6 text-xs font-black ${ui.muted} uppercase tracking-[0.2em] animate-pulse`}>Saving / Importing...</p>
        </div>
      )}
    </div>
  );
}

function Empty({ ui }) {
  return (
    <div className="py-20 text-center space-y-4">
      <p className={`text-4xl ${ui.subtle}`}>🕘</p>
      <p className={`font-bold ${ui.subtle} uppercase text-xs tracking-widest`}>記録がまだありません</p>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder, ui }) {
  return (
    <div className="space-y-1 px-1">
      <label className={`text-[10px] font-black ${ui.muted} uppercase tracking-widest`}>{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`w-full px-5 py-4 rounded-2xl border-2 outline-none font-bold text-sm ${ui.input}`} placeholder={placeholder} />
    </div>
  );
}
