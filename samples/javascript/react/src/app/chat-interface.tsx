'use client';

import React, { useState, useRef } from 'react';
import { Settings, Plus, Send, Mic, MicOff, Power } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Modality, RTClient } from "rt-client";

interface Message {
  type: 'user' | 'assistant' | 'status';
  content: string;
}

interface ToolDeclaration {
  name: string;
  parameters: string;
  returnValue: string;
}

const ChatInterface = () => {
  const [isAzure, setIsAzure] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [deployment, setDeployment] = useState('');
  const [instructions, setInstructions] = useState('');
  const [temperature, setTemperature] = useState(0.9);
  const [modality, setModality] = useState('text');
  const [tools, setTools] = useState<ToolDeclaration[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const clientRef = useRef<RTClient | null>(null);

  const addTool = () => {
    setTools([...tools, { name: '', parameters: '', returnValue: '' }]);
  };

  const updateTool = (index: number, field: string, value: string) => {
    const newTools = [...tools];

    if (field === 'name') {
      newTools[index].name = value;
    } else if (field === 'parameters') {
      newTools[index].parameters = value;
    } else if (field === 'returnValue') {
      newTools[index].returnValue = value;
    }
  };

  const handleConnect = async () => {
    if (!isConnected) {
      try {
        setIsConnecting(true);
        // Construct the client with current settings
        clientRef.current = isAzure ? new RTClient(new URL(endpoint), { key: apiKey} , { deployment }) : new RTClient({ key: apiKey }, { model: 'gpt-4o-realtime-preview-2024-10-01'});
        const modalities: Modality[] = modality === 'audio' ? ['text', 'audio'] : ['text'];
        clientRef.current.configure({
          instructions,
          tools,
          temperature,
          modalities,
        })
        // Start listening for responses
        startResponseListener();

        setIsConnected(true);
      } catch (error) {
        console.error('Connection failed:', error);
        // Here you might want to show an error message to the user
      } finally {
        setIsConnecting(false);
      }
    } else {
      // Disconnect logic
      await disconnect();
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.close();
        clientRef.current = null;
        // responseIteratorRef.current = null;
        setIsConnected(false);
      } catch (error) {
        console.error('Disconnect failed:', error);
      }
    }
  };

  const startResponseListener = async () => {
    if (!clientRef.current) return;

    // Store the iterator reference so we can break the loop if needed
    // responseIteratorRef.current = clientRef.current;

    try {
      for await (const response of clientRef.current.events()) {
        console.log('Response:', response);
        // setMessages(prevMessages => [...prevMessages, {
        //   type: 'assistant',
        //   content: response
        // }]);
      }
    } catch (error) {
      if (clientRef.current) { // Only log error if we haven't intentionally disconnected
        console.error('Response iteration error:', error);
      }
    }
  };

  const sendMessage = async () => {
    if (currentMessage.trim() && clientRef.current) {
      try {
        setMessages(prevMessages => [...prevMessages, {
          type: 'user',
          content: currentMessage
        }]);

        await clientRef.current.sendItem({ type: "message", role: "user", content: [{ type: "input_text", text: currentMessage }] });
        await clientRef.current.generateResponse();
        setCurrentMessage('');
      } catch (error) {
        console.error('Failed to send message:', error);
        // Here you might want to show an error message to the user
      }
    }
  };

  const toggleRecording = () => {
    if (!isRecording) {
      // Start recording
      setIsRecording(true);
      // Here you would call your recorder.start() method
    } else {
      // Stop recording
      setIsRecording(false);
      // Here you would call your recorder.stop() method
    }
  };

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="flex h-screen">
      {/* Parameters Panel */}
      <div className="w-80 bg-gray-50 p-4 flex flex-col border-r">
        <div className="flex-1 overflow-y-auto">
          <Accordion type="single" collapsible className="space-y-4">
            {/* Connection Settings */}
            <AccordionItem value="connection">
              <AccordionTrigger className="text-lg font-semibold">
                Connection Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Use Azure OpenAI</span>
                  <Switch
                    checked={isAzure}
                    onCheckedChange={setIsAzure}
                    disabled={isConnected}
                  />
                </div>

                {isAzure && (
                  <>
                    <Input
                      placeholder="Azure Endpoint"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                      disabled={isConnected}
                    />
                    <Input
                      placeholder="Deployment Name"
                      value={deployment}
                      onChange={(e) => setDeployment(e.target.value)}
                      disabled={isConnected}
                    />
                  </>
                )}

                <Input
                  type="password"
                  placeholder="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={isConnected}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Conversation Settings */}
            <AccordionItem value="conversation">
              <AccordionTrigger className="text-lg font-semibold">
                Conversation Settings
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Instructions</label>
                  <textarea
                    className="w-full min-h-[100px] p-2 border rounded"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    disabled={isConnected}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Tools</label>
                  {tools.map((tool, index) => (
                    <Card key={index} className="p-2">
                      <Input
                        placeholder="Function name"
                        value={tool.name}
                        onChange={(e) => updateTool(index, 'name', e.target.value)}
                        className="mb-2"
                        disabled={isConnected}
                      />
                      <Input
                        placeholder="Parameters"
                        value={tool.parameters}
                        onChange={(e) => updateTool(index, 'parameters', e.target.value)}
                        className="mb-2"
                        disabled={isConnected}
                      />
                      <Input
                        placeholder="Return value"
                        value={tool.returnValue}
                        onChange={(e) => updateTool(index, 'returnValue', e.target.value)}
                        disabled={isConnected}
                      />
                    </Card>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addTool}
                    className="w-full"
                    disabled={isConnected}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Tool
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Temperature ({temperature})</label>
                  <Slider
                    value={[temperature]}
                    onValueChange={([value]) => setTemperature(value)}
                    min={0.6}
                    max={1.2}
                    step={0.1}
                    disabled={isConnected}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Modality</label>
                  <Select
                    value={modality}
                    onValueChange={setModality}
                    disabled={isConnected}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="audio">Audio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Connect Button */}
        <Button
          className="mt-4"
          variant={isConnected ? "destructive" : "default"}
          onClick={handleConnect}
          disabled={isConnecting}
        >
          <Power className="w-4 h-4 mr-2" />
          {isConnecting ? "Connecting..." : isConnected ? "Disconnect" : "Connect"}
        </Button>
      </div>

      {/* Chat Window */}
      <div className="flex-1 flex flex-col">
        {/* Messages Area */}
        <div className="flex-1 p-4 overflow-y-auto">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`mb-4 p-3 rounded-lg ${
                message.type === 'user'
                  ? 'bg-blue-100 ml-auto max-w-[80%]'
                  : 'bg-gray-100 mr-auto max-w-[80%]'
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              placeholder="Type your message..."
              onKeyUp={(e) => e.key === 'Enter' && sendMessage()}
              disabled={!isConnected}
            />
            <Button
              variant="outline"
              onClick={toggleRecording}
              className={isRecording ? "bg-red-100" : ""}
              disabled={!isConnected}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
            <Button
              onClick={sendMessage}
              disabled={!isConnected}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;