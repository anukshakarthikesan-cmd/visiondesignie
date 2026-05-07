import { useState, useEffect, useMemo } from "react";
import { IconChatBubble, IconChevronLeft, IconTrash } from "./SidebarIcons";
import { USER_AVATAR_URL } from "../lib/personaAssets";
import "./Sidebar.css";

export default function Sidebar({
  isOpen,
  isMobile,
  chats,
  currentChatId,
  onSelectChat,
  onDeleteChat,
  deletingId,
  onNewChat,
  onLogout,
  username,
  loadingChats,
  newChatLoading,
  onToggleSidebar,
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch((prev) => (prev === search ? prev : search));
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const filteredChats = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((chat) =>
      (chat.title || "").toLowerCase().includes(q)
    );
  }, [chats, debouncedSearch]);

  const collapsed = !isOpen;
  const mini = collapsed && !isMobile;

  const sidebarClass = [
    "sidebar",
    isOpen ? "open" : "collapsed",
    isMobile ? "mobile" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={sidebarClass} aria-label="Chats">
      <div className="sidebar__inner">
        <div
          className={`sidebar__header-row ${mini ? "sidebar__header-row--mini" : ""}`}
        >
          <div className={`sidebar__brand ${mini ? "sidebar__brand--mini" : ""}`}>
            <img
              className="sidebar__logo"
              src="/visiondesignie-logo.jpg"
              alt=""
              width={36}
              height={36}
              decoding="async"
            />
            {!mini ? (
              <div className="sidebar__brand-text">
                <span className="sidebar__title">VisionDesignie</span>
              </div>
            ) : null}
          </div>
          {!mini && onToggleSidebar ? (
            <button
              type="button"
              className="sidebar__chevron-btn sidebar__chevron-btn--collapse"
              onClick={() => onToggleSidebar()}
              aria-label={isMobile ? "Close sidebar" : "Collapse sidebar"}
              title={isMobile ? "Close sidebar" : "Collapse sidebar"}
            >
              <IconChevronLeft className="sidebar__chevron-svg" />
            </button>
          ) : null}
        </div>

        {!mini ? (
          <input
            type="search"
            className="sidebar__search"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search chats"
          />
        ) : null}

        <button
          type="button"
          className={`sidebar__new ${mini ? "sidebar__new--mini" : ""}`}
          onClick={onNewChat}
          disabled={newChatLoading}
          title="New chat"
        >
          {mini ? "+" : "+ New Chat"}
        </button>

        <nav className="sidebar__list" aria-busy={loadingChats}>
          {loadingChats ? (
            <p className="sidebar__hint">{mini ? "…" : "Loading…"}</p>
          ) : filteredChats.length === 0 ? (
            <p className="sidebar__hint">
              {mini ? "—" : chats.length === 0 ? "No chats yet." : "No matches."}
            </p>
          ) : mini ? (
            filteredChats.map((c) => {
              const title = c.title || "Untitled";
              const active = c.id === currentChatId;
              return (
                <div
                  key={c.id}
                  className={[
                    "sidebar__chat-item",
                    "sidebar__chat-item--mini",
                    active ? "sidebar__chat-item--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="sidebar__chat-select"
                    title={`Open chat: ${title}`}
                    onClick={() => onSelectChat(c.id)}
                  >
                    <span className="sidebar__item-icon-wrap" aria-hidden="true">
                      <IconChatBubble className="sidebar__chat-svg" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="sidebar__chat-delete"
                    aria-label={`Delete chat: ${title}`}
                    title={
                      deletingId === c.id
                        ? "Deleting…"
                        : deletingId !== null
                          ? "Please wait…"
                          : "Delete chat"
                    }
                    disabled={deletingId !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(c.id);
                    }}
                  >
                    <IconTrash className="sidebar__delete-svg" />
                  </button>
                </div>
              );
            })
          ) : (
            <>
              <p className="sidebar__label sidebar__label--section">Chats</p>
              {filteredChats.map((c) => {
                const title = c.title || "Untitled";
                const active = c.id === currentChatId;
                return (
                  <div
                    key={c.id}
                    className={[
                      "sidebar__chat-item",
                      active ? "sidebar__chat-item--active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className="sidebar__chat-select"
                      title={title}
                      onClick={() => onSelectChat(c.id)}
                    >
                      <span
                        className="sidebar__item-icon-wrap"
                        aria-hidden="true"
                      >
                        <IconChatBubble className="sidebar__chat-svg" />
                      </span>
                      <span className="sidebar__item-title">{title}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar__chat-delete"
                      aria-label={`Delete chat: ${title}`}
                      title={
                        deletingId === c.id
                          ? "Deleting…"
                          : deletingId !== null
                            ? "Please wait…"
                            : "Delete chat"
                      }
                      disabled={deletingId !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(c.id);
                      }}
                    >
                      <IconTrash className="sidebar__delete-svg" />
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </nav>

        <div className={`sidebar__footer ${mini ? "sidebar__footer--mini" : ""}`}>
          <div
            className={`sidebar-user ${mini ? "sidebar-user--mini" : ""}`}
            title={username === "" ? "" : username}
          >
            <span className="sidebar-user__avatar" aria-hidden="true">
              <img
                className="sidebar-user__avatar-img"
                src={USER_AVATAR_URL}
                alt=""
                width={28}
                height={28}
                decoding="async"
              />
            </span>
            {!mini ? (
              <span className="sidebar-user__name">
                {username === "" ? "Loading..." : username}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className={`sidebar__logout ${mini ? "sidebar__logout--mini" : ""}`}
            onClick={onLogout}
            title="Log out"
          >
            {mini ? "⎋" : "Log out"}
          </button>
        </div>
      </div>
    </aside>
  );
}
