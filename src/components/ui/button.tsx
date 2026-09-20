import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-display font-medium tracking-wide uppercase transition-[transform,opacity,background-color] duration-150 ease-out select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        accent: "bg-accent text-accent-fg hover:bg-accent/90",
        ghost: "border border-line bg-transparent text-fg hover:bg-raised",
        subtle: "bg-raised text-fg hover:bg-raised/80",
        danger: "bg-danger text-danger-fg hover:bg-danger/90",
      },
      size: {
        sm: "h-10 rounded-sm px-3 text-xs",
        md: "h-11 rounded-md px-4 text-sm",
        lg: "h-14 rounded-md px-5 text-sm",
        xl: "h-16 min-w-36 rounded-lg px-6 text-base",
        icon: "size-11 rounded-md",
      },
    },
    defaultVariants: {
      variant: "accent",
      size: "md",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
