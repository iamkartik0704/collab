"use client";

import { create } from "zustand";

interface UiState {
  cartOpen: boolean;
  mobileNavOpen: boolean;
  setCartOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  cartOpen: false,
  mobileNavOpen: false,
  setCartOpen: (cartOpen) => set({ cartOpen }),
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
}));
