import { useEffect } from 'react';
import { motion, type MotionValue, useSpring, useTransform } from 'motion/react';

export function AnimatedNumber({
  value,
  mass = 0.8,
  stiffness = 75,
  damping = 18,
  precision = 0,
  format = (number) => number.toLocaleString(),
}: {
  value: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  precision?: number;
  format?: (value: number) => string;
}) {
  const spring = useSpring(value, { mass, stiffness, damping });
  const display: MotionValue<string> = useTransform(spring, (current) =>
    format(Number(current.toFixed(precision))),
  );

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}
