import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  content: string;
  className?: string;
}

export function InfoTooltip({ content, className }: InfoTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-help opacity-50 hover:opacity-80 transition-opacity ml-1", className)}>
          <Info size={12} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-center bg-[#112454] border border-[#1A3066] text-[#E8EDF5]">
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
