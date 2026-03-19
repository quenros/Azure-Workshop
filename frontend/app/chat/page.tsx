"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Layout,
  Input,
  Button,
  List,
  Typography,
  Avatar,
  Spin,
  message as antMessage,
} from "antd";
import {
  SendOutlined,
  UserOutlined,
  RobotOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";

const { Header, Content, Footer } = Layout;
const { Text, Title } = Typography;

// --- Configuration ---
const LOCAL_BACKEND_URL = "http://localhost:5000";
const AZURE_BACKEND_URL = "https://asknarelle-portal.azurewebsites.net";

// --- Types ---
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatHistoryItem {
  user_input: string;
  assistant_response: string;
}

export default function ChatPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputText, setInputText] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Dynamic persistent states
  const [courseCode, setCourseCode] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  // Retrieve persistent ID generated in page.tsx
  useEffect(() => {
    // Fallback just in case they navigate directly to /chat somehow
    const storedCode = localStorage.getItem("workshop_course_code") || "workshop-demo";
    console.log("Retrieved course code from localStorage:", storedCode);
    setCourseCode(storedCode);
    setUserId(`user-${storedCode}`);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    setHistoryLoading(false);
  }, []);

  const handleSend = async () => {
    if (!inputText.trim() || !courseCode) return;

    const userMsg = inputText;
    setInputText("");
    setLoading(true);

    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);

    try {
      // =================================================================
      // STEP 1: Search Local Documents First
      // =================================================================
      const docPayload = { message: userMsg };
      
      const docRes = await fetch(`${LOCAL_BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docPayload),
      });

      if (!docRes.ok) throw new Error("Failed to reach local document API");
      
      const docData = await docRes.json();

      // If documents were found (the threshold passed and returned sources)
      if (docData.sources && docData.sources.length > 0) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `From your documents:\n\n${docData.answer}` },
        ]);
        setLoading(false);
        return; // Stop execution here since we found document answers!
      }

      // =================================================================
      // STEP 2: Fallback to Azure Video Search if no documents matched
      // =================================================================
      const previousMessages: ChatHistoryItem[] = [];
      for (let i = 0; i < messages.length - 1; i += 2) {
        if (
          messages[i].role === "user" &&
          messages[i + 1] &&
          messages[i + 1].role === "assistant"
        ) {
          previousMessages.push({
            user_input: messages[i].content,
            assistant_response: messages[i + 1].content,
          });
        }
      }

      const videoPayload = {
        message: userMsg,
        video_ids: [], 
        previous_messages: previousMessages,
        user_id: userId,
      };

      const videoRes = await fetch(`${AZURE_BACKEND_URL}/api/chat/${courseCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(videoPayload),
      });

      if (!videoRes.ok) throw new Error("Failed to reach Azure video API");

      const videoData = await videoRes.json();
      const botResponse = videoData.answer || "Sorry, I couldn't find relevant information in your documents or videos.";
      const source = videoData.source || "unknown";

      let displayResponse = botResponse;
      if (source === "video") {
        displayResponse = `🎥 From your videos:\n\n${botResponse}`;
      } else if (source === "documents") {
         // Failsafe in case your AskNarelle backend returns a document response
         displayResponse = `📄 Found in AskNarelle system:\n\n${botResponse}`;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: displayResponse },
      ]);

    } catch (error) {
      console.error("Chat error:", error);
      antMessage.error("Failed to connect to knowledge base");
      setMessages((prev) => prev.slice(0, -1)); // Remove the user's message if it completely failed
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout style={{ height: "100vh", background: "#fff" }}>
      <Header
        style={{
          background: "#fff",
          borderBottom: "1px solid #f0f0f0",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          Azure Workshop - Knowledge Base Chat
        </Title>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => router.push("/")}
          type="text"
        >
          Back to Files
        </Button>
      </Header>

      <Content
        style={{
          padding: "24px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: "#f5f5f5",
        }}
      >
        <div style={{ width: "100%", maxWidth: 900 }}>
          {messages.length === 0 && !historyLoading && (
            <div style={{ textAlign: "center", marginTop: 100 }}>
              <div
                style={{
                  width: 100,
                  height: 100,
                  background: "#e6f7ff",
                  borderRadius: "50%",
                  margin: "0 auto 24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RobotOutlined style={{ fontSize: 48, color: "#1890ff" }} />
              </div>
              <Title level={2}>Welcome to the Knowledge Base</Title>
              <Text style={{ fontSize: 16, color: "#595959" }}>
                Session: <strong>{courseCode}</strong><br/>
                Ask me anything about your uploaded documents and videos
              </Text>
            </div>
          )}

          {historyLoading && (
            <div style={{ padding: "40px 0", textAlign: "center" }}>
              <Spin size="large" tip="Loading chat history..." />
            </div>
          )}

          {messages.length > 0 && (
            <List
              itemLayout="horizontal"
              dataSource={messages}
              split={false}
              style={{ background: "transparent" }}
              renderItem={(item) => (
                <List.Item
                  style={{
                    padding: "20px 0",
                    border: "none",
                    background: "transparent",
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        size={40}
                        style={{
                          backgroundColor:
                            item.role === "user" ? "#f0f0f0" : "#e6f7ff",
                          color: item.role === "user" ? "#595959" : "#1890ff",
                        }}
                        icon={
                          item.role === "user" ? (
                            <UserOutlined />
                          ) : (
                            <RobotOutlined />
                          )
                        }
                      />
                    }
                    title={
                      <Text strong style={{ fontSize: 14 }}>
                        {item.role === "user" ? "You" : "AI Assistant"}
                      </Text>
                    }
                    description={
                      <div
                        style={{
                          marginTop: 8,
                          padding: "12px 16px",
                          background: "#fff",
                          borderRadius: 8,
                          fontSize: 15,
                          lineHeight: 1.6,
                          whiteSpace: "pre-wrap",
                          color: "rgba(0, 0, 0, 0.88)",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                        }}
                      >
                        {item.content}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          )}

          {loading && (
            <div style={{ padding: "20px 0", textAlign: "center" }}>
              <Spin tip="Searching knowledge base..." />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </Content>

      <Footer
        style={{
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          padding: "16px 24px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 900,
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          <Input.TextArea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Ask a question about your uploaded files..."
            autoSize={{ minRows: 1, maxRows: 5 }}
            style={{
              borderRadius: 8,
              fontSize: 15,
            }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={loading}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={loading}
            size="large"
            style={{ height: "auto", minHeight: 40 }}
          >
            Send
          </Button>
        </div>
      </Footer>
    </Layout>
  );
}