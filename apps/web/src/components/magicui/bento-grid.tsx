import { type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Adapted from Magic UI's BentoGrid (MIT): onClick instead of a Next.js link, plain button.

interface BentoGridProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode;
  className?: string;
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onClick'> {
  name: string;
  className?: string;
  background?: ReactNode;
  Icon: React.ElementType;
  description?: ReactNode;
  cta?: string;
  onClick?: () => void;
  children?: ReactNode;
}

const BentoGrid = ({ children, className, ...props }: BentoGridProps) => (
  <div className={cn('grid w-full auto-rows-[15rem] grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-4', className)} {...props}>
    {children}
  </div>
);

const BentoCard = ({ name, className, background, Icon, description, cta, onClick, children, ...props }: BentoCardProps) => (
  <div
    className={cn(
      'group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-xl',
      'bg-card [box-shadow:0_0_0_1px_rgba(0,0,0,.03),0_2px_4px_rgba(0,0,0,.05),0_12px_24px_rgba(0,0,0,.05)]',
      'transform-gpu dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset] dark:[border:1px_solid_rgba(255,255,255,.1)]',
      className,
    )}
    {...props}
  >
    <div className="pointer-events-none absolute inset-0">{background}</div>
    <div className="relative z-10 flex h-full flex-col p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <h3 className="text-sm font-medium">{name}</h3>
      </div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-2 min-h-0 flex-1">{children}</div>
    </div>
    {cta && onClick && (
      <button
        onClick={onClick}
        className="absolute right-3 bottom-3 z-20 flex translate-y-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 focus:opacity-100"
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    )}
    <div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-black/[.02] group-hover:dark:bg-white/[.03]" />
  </div>
);

export { BentoCard, BentoGrid };
