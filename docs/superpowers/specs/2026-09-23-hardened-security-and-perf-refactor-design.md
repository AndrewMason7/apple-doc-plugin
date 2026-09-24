# Hardened Security, Memory Safety & Performance Refactor — Design Spec

## 1. Intent & Scope

This specification hardens the `apple-doc-plugin` based on findings from the Elite Code Review Tribunal (/roast):

1. **Secret Credential Hygiene (CWE-532)**: Move `GEMINI_API_KEY` from the URL query string (`?key=...`) to the standard `x-goog-api-key` HTTP header.
2. **Buffer Alignment Safety (CWE-125 / RangeError)**: Eliminate `Float32Array` crashes on unaligned memory buffers from Node's pooled `Buffer` instances by copying to aligned `ArrayBuffer`.
3. **Zero-Disk-Scan Vector Cache & $L_2$ Precomputation**: Cache vector items in memory once at startup, pre-computing their $L_2$ norms to replace expensive `SELECT * FROM semantic_items` queries and reduce cosine similarity to a pure dot-product.
4. **FTS5 Syntax & LIKE Wildcard Sanitization**: Strip dangerous FTS5 control characters (`*`, `(`, `)`, `:`, `"`, `^`) and escape LIKE query characters (`%`, `_`) to eliminate query injection and catastrophic fallback table scans.
5. **Defensive JSON Parsing**: Protect against unhandled `SyntaxError` crashes on corrupted platform metadata.
6. **Circuit Breaker**: Add fail-fast 30s timeout tripped on 429 rate limit or 5xx server errors to protect agent responsiveness.
