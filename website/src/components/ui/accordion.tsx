import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'

export const Accordion = AccordionPrimitive.Root
export const AccordionItem = AccordionPrimitive.Item

export function AccordionTrigger({ children, ...props }: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger className="faq-trigger flex w-full items-center justify-between gap-5 text-left font-semibold" {...props}>
        {children}<ChevronDown size={18} aria-hidden="true" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

export function AccordionContent({ children, ...props }: ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content className="faq-content" {...props}><div>{children}</div></AccordionPrimitive.Content>
}
