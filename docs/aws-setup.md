# AWS Setup Guide for Watchmen

To allow Watchmen to scan your AWS account, you need to create an IAM user with programmatic access and the necessary read-only permissions.

## Step-by-Step Instructions

1.  **Log in to the AWS Management Console.**
2.  **Navigate to IAM.**
3.  **Create a new User:**
    *   Click **Users** > **Create user**.
    *   **User name**: `watchmen-scanner`.
    *   Click **Next**.
4.  **Set Permissions:**
    *   Select **Attach policies directly**.
    *   Search for and select: `ReadOnlyAccess` (Managed policy).
    *   *Alternative (Recommended for Least Privilege)*: Create a custom policy with only the specific `Describe*`, `List*`, and `Get*` permissions needed for the resources you want to scan.
5.  **Review and Create:**
    *   Click **Next**, then **Create user**.
6.  **Create Access Key:**
    *   Select the newly created user `watchmen-scanner`.
    *   Click the **Security credentials** tab.
    *   Under **Access keys**, click **Create access key**.
    *   Select **Third-party service**.
    *   Click **Next**, add a description (e.g., "Watchmen Scanner Key"), and click **Create access key**.
7.  **Store Credentials:**
    *   **IMPORTANT**: Download or copy the **Access key ID** and **Secret access key**. You will not be able to see the secret key again.

## Configuring Watchmen

In the Watchmen dashboard:
1.  Go to **Settings** > **Cloud Credentials**.
2.  Enter your **Access Key ID**, **Secret Access Key**, and **Default Region** in the AWS section.
3.  Click **Save**.
