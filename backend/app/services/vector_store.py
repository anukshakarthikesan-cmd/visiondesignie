from __future__ import annotations

import contextlib
import io
import logging
import os
import warnings

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

from app.services.embeddings import get_embeddings


# Absolute paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DATA_PATH = os.path.join(BASE_DIR, "data", "documents")
DB_PATH = os.path.join(BASE_DIR, "data", "vector_store")

# Do not descend into these (names under data/documents)
_SKIP_DIRS = frozenset({".git", "__pycache__", ".venv", "venv", "node_modules", "vector_store"})

# Try these before lossy decode
_TXT_ENCODINGS = ("utf-8", "utf-8-sig", "cp1252", "latin-1")


def _quiet_pypdf_logging() -> None:
    for name in ("pypdf", "pypdf._reader", "pypdf.generic", "pypdf.xmp", "PyPDF2"):
        logging.getLogger(name).setLevel(logging.ERROR)


def _load_pdf_as_documents(file_path: str, source_rel: str) -> list[Document]:
    """Load PDF with strict=False; suppress pypdf stderr noise from damaged PDFs."""
    source_norm = source_rel.replace("\\", "/")
    out: list[Document] = []
    stderr_buf = io.StringIO()
    with contextlib.redirect_stderr(stderr_buf), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        reader = PdfReader(file_path, strict=False)
        for i, page in enumerate(reader.pages):
            try:
                text = (page.extract_text() or "").strip()
            except Exception:
                text = ""
            if not text:
                continue
            out.append(
                Document(
                    page_content=text,
                    metadata={"source": source_norm, "page": i},
                )
            )
    return out


def _load_txt_as_documents(file_path: str, source_rel: str) -> list[Document]:
    """Read text with encoding fallbacks; never raises for encoding alone."""
    text = None
    for enc in _TXT_ENCODINGS:
        try:
            with open(file_path, "r", encoding=enc) as f:
                text = f.read()
            break
        except (UnicodeDecodeError, UnicodeError):
            continue

    if text is None:
        with open(file_path, "rb") as f:
            text = f.read().decode("utf-8", errors="replace")

    text = text.replace("\x00", "")
    if not text.strip():
        return []

    source_norm = source_rel.replace("\\", "/")
    return [Document(page_content=text, metadata={"source": source_norm})]


def load_documents():
    _quiet_pypdf_logging()
    documents: list[Document] = []

    file_paths: list[str] = []
    for root, dirs, names in os.walk(DATA_PATH, topdown=True):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for name in names:
            lower = name.lower()
            if lower.endswith(".pdf") or lower.endswith(".txt"):
                file_paths.append(os.path.join(root, name))
    file_paths.sort()
    rels = [os.path.relpath(p, DATA_PATH) for p in file_paths]
    print("[documents] FILES FOUND:", len(rels), "under", DATA_PATH)
    if len(rels) <= 40:
        for r in rels:
            print("   ", r)

    txt_ok = txt_fail = pdf_ok = pdf_fail = 0
    txt_empty = pdf_empty = 0

    for file_path in file_paths:
        rel = os.path.relpath(file_path, DATA_PATH)

        if file_path.lower().endswith(".pdf"):
            try:
                docs = _load_pdf_as_documents(file_path, rel)
                if not docs:
                    print(f"[documents] WARN empty PDF (no extractable text): {rel}")
                    pdf_empty += 1
                    continue
                documents.extend(docs)
                pdf_ok += 1
            except Exception as e:
                print(f"[documents] FAIL PDF {rel}: {e}")
                pdf_fail += 1
            continue

        if file_path.lower().endswith(".txt"):
            try:
                docs = _load_txt_as_documents(file_path, rel)
                if not docs:
                    print(f"[documents] WARN empty TXT: {rel}")
                    txt_empty += 1
                    continue
                documents.extend(docs)
                txt_ok += 1
            except Exception as e:
                print(f"[documents] FAIL TXT {rel}: {e}")
                txt_fail += 1

    print(
        "[documents] Summary: "
        f"txt_ok={txt_ok} txt_empty={txt_empty} txt_fail={txt_fail} | "
        f"pdf_ok={pdf_ok} pdf_empty={pdf_empty} pdf_fail={pdf_fail}"
    )
    print(f"[documents] Document pages / parts loaded: {len(documents)}")
    return documents


def split_documents(documents):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=100
    )

    chunks = splitter.split_documents(documents)
    print(f"[documents] Chunks created: {len(chunks)}")

    return chunks


def create_vector_store():
    documents = load_documents()

    if not documents:
        raise ValueError("No documents found. Check your data/documents folder.")

    chunks = split_documents(documents)

    if not chunks:
        raise ValueError("No chunks created. Check document loading.")

    embeddings = get_embeddings()

    print("[documents] Creating embeddings... (this takes time)")

    vectorstore = FAISS.from_documents(chunks, embeddings)

    # ✅ Ensure folder exists
    os.makedirs(DB_PATH, exist_ok=True)

    vectorstore.save_local(DB_PATH)

    print("[documents] Vector store created successfully.")


def load_vector_store():
    embeddings = get_embeddings()

    # ✅ Ensure DB exists
    if not os.path.exists(DB_PATH):
        raise ValueError("Vector store not found. Run create_vector_store() first.")

    return FAISS.load_local(
        DB_PATH,
        embeddings,
        allow_dangerous_deserialization=True
    )