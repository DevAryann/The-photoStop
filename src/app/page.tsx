"use client";

import { useState } from "react";

export default function Home() {
  const [roomCode, setRoomCode] = useState("");

  const handleCreateRoom = () => {
    // Placeholder for future room creation logic
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder for future room join logic
  };

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow alphanumeric and hyphen, uppercase
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    setRoomCode(value);
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 sm:px-12 md:px-24">
      <div className="w-full max-w-md flex flex-col items-center gap-12">
        {/* Hero Section */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex flex-col gap-3">
            <h1 className="text-[48px] leading-[56px] font-bold tracking-tight">
              Photobooth
            </h1>
            <p className="text-lg leading-7 text-[var(--text-secondary)]">
              Modern digital photobooth × nostalgic photo strip
            </p>
          </div>
          <p className="text-base leading-6 text-[var(--text-secondary)] max-w-[40ch]">
            Create photo strips together. Capture four moments, customize with filters and stickers, download in seconds.
          </p>
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-6">
          {/* Primary Action: Create Room */}
          <button
            onClick={handleCreateRoom}
            className="group w-full h-12 px-6 rounded-lg bg-gradient-to-r from-[var(--primary)] to-[var(--secondary)] text-[var(--text-primary)] text-sm font-semibold uppercase tracking-wide transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            Create a Room
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
              or
            </span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          {/* Join Room */}
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-3">
            <label htmlFor="room-code" className="sr-only">
              Room code
            </label>
            <input
              id="room-code"
              type="text"
              value={roomCode}
              onChange={handleRoomCodeChange}
              placeholder="Enter room code (e.g. MOON-47)"
              maxLength={20}
              className="w-full h-12 px-4 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-tertiary)] transition-colors focus:outline-none focus:border-[var(--primary)] focus:ring-[3px] focus:ring-[var(--primary)]/20"
            />
            <button
              type="submit"
              disabled={roomCode.length === 0}
              className="w-full h-12 px-6 rounded-lg bg-transparent border border-[var(--border-active)] text-[var(--text-primary)] text-sm font-semibold uppercase tracking-wide transition-colors hover:border-[var(--primary)] hover:bg-[var(--primary)]/10 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[var(--border-active)] disabled:hover:bg-transparent"
            >
              Join Room
            </button>
          </form>
        </div>

        {/* Subtle Visual Indicator */}
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--text-tertiary)] font-medium">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="opacity-50"
          >
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 1.5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>4 photos • Unlimited rooms</span>
        </div>
      </div>
    </main>
  );
}
