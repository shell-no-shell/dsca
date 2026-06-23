import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export function Spinner() {
  const [frame, setFrame] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
    }, 120);
    return () => clearInterval(timer);
  }, []);

  return <Text color="cyan">{frames[frame]}</Text>;
}

export interface Step {
  id: number;
  type: string;
  description: string;
  tools?: string[];
  files?: string[];
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

export function SpinnerPanel({ state, message }: { state: string; message: string }) {
  return (
    <Box flexDirection="row" alignItems="center" marginY={1}>
      <Spinner />
      <Text bold marginX={1} color="magenta">
        [{state}]
      </Text>
      <Text color="white">{message}</Text>
    </Box>
  );
}

export function StepList({ steps }: { steps: Step[] }) {
  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold color="yellow">📋 Plan Execution Steps</Text>
      {steps.map(step => {
        let symbol = '⚪';
        let color = 'gray';
        if (step.status === 'running') {
          symbol = '🔄';
          color = 'blue';
        } else if (step.status === 'completed') {
          symbol = '✅';
          color = 'green';
        } else if (step.status === 'failed') {
          symbol = '❌';
          color = 'red';
        } else if (step.status === 'skipped') {
          symbol = '⏭️';
          color = 'yellow';
        }
        return (
          <Box key={step.id} marginLeft={2}>
            <Text color={color}>
              {symbol} Step {step.id} [{step.type}]: {step.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function TokenCounter({
  promptTokens,
  completionTokens,
  cost
}: {
  promptTokens: number;
  completionTokens: number;
  cost: number;
}) {
  return (
    <Box borderStyle="double" borderColor="green" paddingX={2} paddingY={1} flexDirection="column" width={45} marginY={1}>
      <Text bold color="green">💰 Token Usage & Cost Estimator</Text>
      <Text color="white">Prompt Tokens:     {promptTokens}</Text>
      <Text color="white">Completion Tokens: {completionTokens}</Text>
      <Text color="white">Total Tokens:      {promptTokens + completionTokens}</Text>
      <Box borderStyle="single" borderColor="green" paddingX={1} marginY={1}>
        <Text bold color="yellow">Estimated Cost:  ${cost.toFixed(5)} USD</Text>
      </Box>
    </Box>
  );
}

export function DiffViewer({ diffText }: { diffText: string }) {
  const lines = diffText.split('\n');
  return (
    <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="blue" paddingX={1}>
      <Text bold color="blue">🔍 Code Changes View</Text>
      {lines.map((line, idx) => {
        let color = 'white';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          color = 'green';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          color = 'red';
        } else if (line.startsWith('@@')) {
          color = 'cyan';
        }
        return (
          <Text key={idx} color={color}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}
