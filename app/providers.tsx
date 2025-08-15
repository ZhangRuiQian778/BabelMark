"use client";
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Toast from '@radix-ui/react-toast';
import React from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={100}>
      <Toast.Provider swipeDirection="right" duration={3000}>
        {children}
        <Toast.Viewport className="fixed bottom-0 right-0 z-50 m-4 w-96 max-w-full outline-none" />
      </Toast.Provider>
    </Tooltip.Provider>
  );
}
