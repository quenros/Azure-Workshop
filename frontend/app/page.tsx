"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Typography,
  Space,
  Button,
  Spin,
  Flex,
  Table,
  Tag,
  Popconfirm,
  Upload,
  Modal,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  PlusOutlined,
  MessageOutlined,
  DeleteOutlined,
  LoadingOutlined,
  UploadOutlined,
  InboxOutlined,
} from "@ant-design/icons";

const { Title } = Typography;
const { Dragger } = Upload;

// --- Configuration ---
// routed using next.config.js rewrites to avoid CORS issues and hide backend details from frontend code
const LOCAL_BACKEND_URL = "";
const AZURE_BACKEND_URL = "https://asknarelle-portalworkshop.azurewebsites.net";

// --- Types ---
interface FileData {
  id: string;
  name: string;
  type: string;
  date: string;
  status?: string;
  url?: string;
}

const DOC_EXTS = [".pdf", ".docx", ".txt"];
const VIDEO_EXTS = [".mp4", ".mov"];

const getExt = (name: string) => {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
};

const isDoc = (name: string) => DOC_EXTS.includes(getExt(name));
const isVideo = (name: string) => VIDEO_EXTS.includes(getExt(name));

export default function FileManagementPage() {
  const router = useRouter();

  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [uploadModalVisible, setUploadModalVisible] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [fileList, setFileList] = useState<any[]>([]);
  
  const [courseCode, setCourseCode] = useState<string>("");

  useEffect(() => {
    let storedCode = localStorage.getItem("workshop_course_code");
    if (!storedCode) {
      const randomId = Math.floor(Math.random() * 900) + 100;
      storedCode = `${randomId}`;
      localStorage.setItem("workshop_course_code", storedCode);
    }
    setCourseCode(storedCode);
  }, []);

  // --- LOCAL FILE FETCHING ---
  const fetchFiles = useCallback(async (isPolling = false) => {
    if (!courseCode) return;
    if (!isPolling) setLoading(true);

    try {
      const docResponse = await fetch(`${LOCAL_BACKEND_URL}/api/files`);
      const localFiles: FileData[] = docResponse.ok ? await docResponse.json() : [];

      // Merge local files with any videos currently processing in frontend memory
      setFiles((prevFiles) => {
        const processingVideos = prevFiles.filter(f => f.status === "IN_PROGRESS");
        const cleanLocal = localFiles.filter(lf => !processingVideos.some(pv => pv.name === lf.name));
        return [...cleanLocal, ...processingVideos];
      });
      
    } catch (err: any) {
      console.error("Error fetching files:", err);
      if (!isPolling) message.error("Failed to load local files");
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, [courseCode]);

  useEffect(() => {
    if (courseCode) fetchFiles(false);
  }, [courseCode, fetchFiles]);


  // --- VIDEO POLLING & INDEXING LOGIC ---
  const pollVideoStatus = async (taggedName: string, originalName: string, videoFileObj: File) => {
    try {
      const response = await fetch(`${LOCAL_BACKEND_URL}/api/local/video/status/${taggedName}`);
      const data = await response.json();

      if (data.status === "Completed") {
        message.success(`Transcript ready! Indexing ${originalName} to search...`);
        
        // 1. Index the transcript
        await indexTranscriptLocally(originalName, data.transcript);
        
        // 2. Permanently save the MP4 to the videos Blob container
        message.info(`Saving ${originalName} to local Blob Storage...`);
        await saveVideoToBlob(videoFileObj);

        // Remove the temporary processing state from UI and fetch real local files
        setFiles(prev => prev.filter(f => f.id !== taggedName));
        fetchFiles(false);

      } else if (data.status?.startsWith("Error")) {
        message.error(`Processing failed for ${originalName}: ${data.status}`);
        setFiles(prev => prev.filter(f => f.id !== taggedName));
      } else {
        // Still processing, poll again in 5 seconds
        setTimeout(() => pollVideoStatus(taggedName, originalName, videoFileObj), 5000);
      }
    } catch (error: any) {
      console.error("Polling error:", error);
    }
  };

  const saveVideoToBlob = async (videoFileObj: File) => {
    // Safety check in case the file reference was dropped
    if (!videoFileObj) {
      message.error("Video file reference lost. Could not save to Blob.");
      return;
    }

    const formData = new FormData();
    formData.append("video", videoFileObj);
    try {
      const response = await fetch(`${LOCAL_BACKEND_URL}/api/local/save_video_blob`, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        throw new Error("Failed to upload video to Azure Blob Storage.");
      }
    } catch (error: any) {
      message.error(`Blob save error: ${error.message}`);
    }
  };

  const indexTranscriptLocally = async (filename: string, cleanTranscript: string) => {
    try {
      const response = await fetch(`${LOCAL_BACKEND_URL}/api/local/index_transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: cleanTranscript })
      });
      
      if (!response.ok) {
        message.error(`Failed to save transcript for ${filename} locally.`);
      }
    } catch (error: any) {
      message.error(`Local indexing error: ${error.message}`);
    }
  };

  // --- UPLOAD HANDLER ---
  const handleUpload = async () => {
    if (fileList.length === 0) {
      message.warning("Please select files to upload");
      return;
    }

    setUploading(true);

    const videoFiles = fileList.filter((f) => isVideo(f.name));
    const documentFiles = fileList.filter((f) => isDoc(f.name));

    let successCount = 0;

    // 1. Upload Documents (Local)
    if (documentFiles.length > 0) {
      try {
        const formData = new FormData();
        documentFiles.forEach((file) => {
          if (file.originFileObj) formData.append("files", file.originFileObj);
        });

        const response = await fetch(`${LOCAL_BACKEND_URL}/api/files`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          successCount += documentFiles.length;
        } else {
          message.error("Failed to upload some documents locally.");
        }
      } catch (error: any) {
        message.error("Error connecting to local backend for documents.");
      }
    }

    // 2. Upload Videos (via Local Proxy to Azure)
    if (videoFiles.length > 0) {
      for (const file of videoFiles) {
        try {
          const formData = new FormData();
          formData.append("video", file.originFileObj);
          formData.append("session_id", courseCode);

          console.log(`[Upload Started] Sending ${file.name} to local proxy...`);

          const videoResponse = await fetch(`${LOCAL_BACKEND_URL}/api/local/video/upload`, {
            method: "POST",
            body: formData,
          });

          if (videoResponse.ok) {
            const result = await videoResponse.json();
            successCount += 1;
            message.info(`${file.name} sent successfully. Transcribing...`);

            setFiles(prev => [...prev, {
              id: result.tagged_name,
              name: file.name,
              type: "video",
              date: new Date().toISOString().split('T')[0],
              status: "IN_PROGRESS"
            }]);

            pollVideoStatus(result.tagged_name, file.name, file.originFileObj);
          } else {
            const errorText = await videoResponse.text();
            console.error(`[Server Error - ${file.name}] Status: ${videoResponse.status}. Details:`, errorText);
            message.error(`Server rejected ${file.name}. Check console.`);
          }
        } catch (error: any) {
          console.error(`[Network/Fetch Error - ${file.name}]:`, error);
          message.error(`Network crash for ${file.name}. Check console.`);
        }
      }
    }

    if (successCount > 0) {
      setUploadModalVisible(false);
      setFileList([]);
      // FIX: Force the table to refresh so documents appear immediately!
      fetchFiles(false);
    }
    setUploading(false);
  };

  // --- DELETE HANDLER ---
  const handleDelete = async (file: FileData) => {
    try {
      const response = await fetch(`${LOCAL_BACKEND_URL}/api/files/${file.id}`, {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete document");

      message.success("File deleted successfully");
      fetchFiles(false);
    } catch (error: any) {
      message.error("Failed to delete file");
    }
  };

  const handleChatClick = () => {
    router.push("/chat");
  };

  const columns: ColumnsType<FileData> = [
    {
      title: "File Name",
      dataIndex: "name",
      key: "name",
      ellipsis: true,
      render: (_, record) => (
        <Space size="small">
          <span>{record.name}</span>
          {record.type === "document" && <Tag color="cyan">Document</Tag>}
          {record.type === "video" && <Tag color="purple">Video</Tag>}
        </Space>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 150,
      render: (_, record) => {
        if (record.status === "IN_PROGRESS") {
          return <Tag icon={<LoadingOutlined spin />} color="processing">Processing...</Tag>;
        }
        return <Tag color="success">Indexed</Tag>;
      },
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      width: 140,
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, record) => {
        const isProcessing = record.status === "IN_PROGRESS";
        return (
          <Popconfirm
            title="Delete file"
            onConfirm={() => handleDelete(record)}
            okText="Delete"
            disabled={isProcessing}
          >
            <Button danger icon={<DeleteOutlined />} size="small" disabled={isProcessing}>
              Delete
            </Button>
          </Popconfirm>
        );
      },
    },
  ];

  const uploadProps = {
    multiple: true,
    fileList,
    onChange: ({ fileList: newFileList }: any) => setFileList(newFileList),
    beforeUpload: () => false, 
    onRemove: (file: any) => setFileList((prev) => prev.filter((f) => f.uid !== file.uid)),
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <Flex justify="space-between" align="center" style={{ marginBottom: 24 }}>
          <div>
            <Title level={2} style={{ margin: 0 }}>Azure Workshop - File Management</Title>
            <Typography.Text type="secondary">Session ID: <strong>{courseCode || "Loading..."}</strong></Typography.Text>
          </div>
          <Space>
            <Button type="default" icon={<MessageOutlined />} onClick={handleChatClick} size="large">
              Chat with Knowledge Base
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadModalVisible(true)} size="large">
              Upload Files
            </Button>
          </Space>
        </Flex>

        {loading ? (
          <Flex align="center" justify="center" vertical gap="middle" style={{ minHeight: 400, background: "#fff", borderRadius: 8 }}>
            <Spin size="large" />
            <Typography.Text type="secondary">Loading files...</Typography.Text>
          </Flex>
        ) : files.length > 0 ? (
          <div style={{ background: "#fff", padding: 24, borderRadius: 8 }}>
            <Table<FileData> columns={columns} dataSource={files} rowKey="id" pagination={{ pageSize: 10 }} bordered />
          </div>
        ) : (
          <div style={{ background: "#fff", padding: 80, borderRadius: 8, textAlign: "center" }}>
            <InboxOutlined style={{ fontSize: 64, color: "#bfbfbf" }} />
            <Title level={4} style={{ marginTop: 16, color: "#595959" }}>No files uploaded yet</Title>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadModalVisible(true)} size="large" style={{ marginTop: 16 }}>
              Upload Your First File
            </Button>
          </div>
        )}
      </div>

      <Modal
        title="Upload Files"
        open={uploadModalVisible}
        onCancel={() => { setUploadModalVisible(false); setFileList([]); }}
        footer={[
          <Button key="cancel" onClick={() => { setUploadModalVisible(false); setFileList([]); }}>Cancel</Button>,
          <Button key="upload" type="primary" loading={uploading} onClick={handleUpload} disabled={fileList.length === 0}>Upload</Button>,
        ]}
        width={600}
      >
        <Dragger {...uploadProps} style={{ marginTop: 16 }}>
          <p className="ant-upload-drag-icon"><UploadOutlined style={{ fontSize: 48, color: "#1890ff" }} /></p>
          <p className="ant-upload-text">Click or drag files to this area to upload</p>
          <p className="ant-upload-hint">Support for documents (PDF, DOCX, TXT) and videos (MP4, MOV)</p>
        </Dragger>
      </Modal>
    </div>
  );
}