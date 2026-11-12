"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface NativeModalDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  allowLightDismiss?: boolean;
  maxWidthClass?: string;
  children: React.ReactNode;
}

export function NativeModalDialog({
  open,
  onClose,
  title,
  subtitle,
  allowLightDismiss = true,
  maxWidthClass = "max-w-xl",
  children,
}: NativeModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };

    dialog.addEventListener("close", handleClose);

    // Fallback for browsers without native <dialog closedby="any"> support
    let handleBackdropClick: ((event: MouseEvent) => void) | null = null;
    if (allowLightDismiss && !("closedBy" in HTMLDialogElement.prototype)) {
      handleBackdropClick = (event: MouseEvent) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      };
      dialog.addEventListener("click", handleBackdropClick);
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      if (handleBackdropClick) {
        dialog.removeEventListener("click", handleBackdropClick);
      }
    };
  }, [allowLightDismiss, onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      {...({ closedby: allowLightDismiss ? "any" : "closerequest" } as Record<
        string,
        string
      >)}
      className={`m-auto w-full ${maxWidthClass} rounded-2xl border border-slate-200/90 bg-white p-0 text-slate-900 shadow-2xl open:block`}
    >
      <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close dialog"
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
}

