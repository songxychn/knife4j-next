import { Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

const { Text } = Typography;

const descriptionTextStyle: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

interface DescriptionTextProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  type?: 'secondary' | 'success' | 'warning' | 'danger';
}

export default function DescriptionText({ children, style, ...textProps }: DescriptionTextProps) {
  return (
    <Text {...textProps} style={{ ...descriptionTextStyle, ...style }}>
      {children}
    </Text>
  );
}
